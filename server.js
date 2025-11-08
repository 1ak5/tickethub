const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const http = require("http")
const socketIO = require("socket.io")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")
const Razorpay = require("razorpay")
const nodemailer = require("nodemailer")
require("dotenv").config()

const app = express()
const server = http.createServer(app)
const io = socketIO(server, { cors: { origin: "*" } })

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_1IA8jJelqMKj7K",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "PWV834UI5fwzYW1Zx065wPs1",
})

// Initialize Email Service
const EMAIL_ENABLED = (process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true'
const emailService = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "your-email@gmail.com",
    pass: process.env.EMAIL_PASSWORD || "your-app-password",
  },
})

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static("public"))

// ============= SCHEMAS & MODELS =============

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  password: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
  createdAt: { type: Date, default: Date.now },
})

// Hall Schema
const hallSchema = new mongoose.Schema({
  name: String,
  city: String,
  totalSeats: Number,
  rows: Number,
  seatsPerRow: Number,
  seatLayout: {
    type: Array, // Array of {row: "A", seats: [1,2,3...]} to allow custom blocked seats
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
})

// Event Schema
const eventSchema = new mongoose.Schema({
  title: String,
  description: String,
  venue: String,
  hallId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hall' },
  date: Date,
  time: String,
  price: Number,
  totalSeats: Number,
  bookedSeats: { type: Number, default: 0 },
  image: String,
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  rows: { type: Number, default: 10 },
  seatsPerRow: { type: Number, default: 10 },
  customLayout: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
})

// Seat Schema
const seatSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  row: { type: String, required: true },
  seatNumber: { type: Number, required: true },
  status: { type: String, enum: ["available", "booked", "blocked"], default: "available" },
  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
})

// Manage indexes properly on model initialization
seatSchema.pre('save', function(next) {
  // This ensures the index exists before any save operations
  this.constructor.ensureIndexes().catch(err => {
    console.error('[v0] Error ensuring indexes:', err)
  })
  next()
})

// Create compound unique index on eventId, row, and seatNumber
seatSchema.index(
  { eventId: 1, row: 1, seatNumber: 1 }, 
  { 
    unique: true,
    background: true,
    name: "unique_seat_per_event"
  }
)

// Handle index errors at model level
seatSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoError' && error.code === 11000) {
    console.error('[v0] Duplicate key error:', {
      eventId: doc.eventId,
      row: doc.row,
      seatNumber: doc.seatNumber
    })
    next(new Error('A seat with these details already exists.'))
  } else {
    next(error)
  }
})

// Booking Schema
const bookingSchema = new mongoose.Schema({
  bookingId: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  seats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Seat' }],
  totalAmount: Number,
  status: { type: String, enum: ["pending", "confirmed", "cancelled"], default: "pending" },
  paymentId: String,
  paymentMethod: String,
  paymentStatus: String,
  contactName: String,
  contactEmail: String,
  qrCode: String,
  ticketSentToEmail: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
})

// Ensure bookingId is unique only when present (avoid null duplicates)
bookingSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $type: 'string' } } }
)

// Create Models
const User = mongoose.model('User', userSchema)
const Hall = mongoose.model('Hall', hallSchema)
const Event = mongoose.model('Event', eventSchema)
const Seat = mongoose.model('Seat', seatSchema)
const Booking = mongoose.model('Booking', bookingSchema)

// MongoDB Connection
mongoose.connect(process.env.MONGO_URL || "mongodb+srv://suryawanshiaditya915:j28ypFv6unzrodIz@notesapp.d3r8gkc.mongodb.net/notes-app?retryWrites=true&w=majority", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})

mongoose.connection.on("connected", async () => {
  try {
    console.log("Database connected successfully")
    // Keep bookingId index healthy
    try {
      await Booking.syncIndexes()
    } catch (e) {
      console.warn('[booking] syncIndexes warning:', e?.message)
    }

    // Migrate Seat indexes: drop legacy hallId-based indexes if present and ensure correct ones
    try {
      const indexes = await Seat.collection.indexes()
      const legacySeatIndexes = indexes.filter((idx) => {
        const keys = Object.keys(idx.key || {})
        return keys.includes('hallId') && keys.includes('seatNumber')
      })

      for (const idx of legacySeatIndexes) {
        try {
          console.warn(`[migrate] Dropping legacy seat index: ${idx.name}`)
          await Seat.collection.dropIndex(idx.name)
        } catch (dropErr) {
          // Ignore if already dropped
          if (!/index not found/i.test(dropErr?.message || '')) {
            console.warn('[migrate] Failed to drop legacy index:', idx.name, dropErr?.message)
          }
        }
      }

      // Ensure current indexes are in place
      await Seat.syncIndexes()
      console.log('[migrate] Seat indexes are up to date')
    } catch (idxErr) {
      console.warn('[migrate] Seat index migration warning:', idxErr?.message)
    }
  } catch (err) {
    console.log("Database connected with error:", err)
  }
})

// Create seats for an event based on hall layout
async function createSeatsForEvent(event, hall) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const seats = [];
  
  for (let i = 0; i < hall.rows; i++) {
    const rowLabel = alphabet[i];
    for (let j = 1; j <= hall.seatsPerRow; j++) {
      seats.push({
        eventId: event._id,
        row: rowLabel,
        seatNumber: j,
        status: 'available'
      });
    }
  }
  
  await Seat.insertMany(seats);
}

// Continue with routes and functions

// ============= UTILITIES =============

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key_123"

const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "7d" })
}

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (err) {
    return null
  }
}

function generateBookingId(userId, eventId) {
  const uid = (userId || '').toString().slice(-4)
  const eid = (eventId || '').toString().slice(-4)
  const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `BK-${Date.now()}-${uid}-${eid}-${rnd}`
}

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]
  if (!token) return res.status(401).json({ error: "No token provided" })

  const decoded = verifyToken(token)
  if (!decoded) return res.status(401).json({ error: "Invalid token" })

  req.user = decoded
  next()
}

// ============= AUTH ROUTES =============

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body

    const existingUser = await User.findOne({ email })
    if (existingUser) return res.status(400).json({ error: "Email already exists" })

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = new User({ name, email, password: hashedPassword })
    await user.save()

    const token = generateToken(user._id, user.role)
    res.json({ token, user: { id: user._id, name, email, role: user.role } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email })
    if (!user) return res.status(401).json({ error: "Invalid credentials" })

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" })

    const token = generateToken(user._id, user.role)
    res.json({ token, user: { id: user._id, name: user.name, email, role: user.role } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= HALL ROUTES =============

app.get("/api/halls", async (req, res) => {
  try {
    const halls = await Hall.find()
    res.json(halls)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/halls", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const { name, city, totalSeats, rows, seatsPerRow, seatLayout } = req.body
    const hall = new Hall({ name, city, totalSeats, rows, seatsPerRow, seatLayout })
    await hall.save()
    res.json(hall)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/halls/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    await Hall.findByIdAndDelete(req.params.id)
    res.json({ message: "Hall deleted" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= EVENT ROUTES =============

app.get("/api/events", async (req, res) => {
  try {
    const events = await Event.find().populate("hallId")
    res.json(events)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/events/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate({
      path: 'hallId',
      select: 'name rows seatsPerRow totalSeats city'
    })
    if (!event) return res.status(404).json({ error: "Event not found" })
    res.json(event)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/events", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const { title, description, hallId, venue, date, time, price, image } = req.body

    // Create event with fixed 10x10 layout
    const event = new Event({
      title,
      description,
      venue,
      hallId,
      date,
      time,
      price,
      rows: 10,
      seatsPerRow: 10,
      totalSeats: 100,
      image: image || "/images/default-event.jpg",
    })

    await event.save()

    console.log(`[v0] Creating default 10x10 layout for event ${event._id}`)

    // Create exactly 10x10 seats
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const seatsToCreate = []

    for (let i = 0; i < 10; i++) {
      const rowLabel = alphabet[i]
      for (let j = 1; j <= 10; j++) {
        seatsToCreate.push({
          eventId: event._id,
          row: rowLabel,
          seatNumber: j,
          status: 'available'
        })
      }
    }

    // Create seats in smaller batches with better error handling
    async function tryCreateSeats() {
      const batchSize = 20 // Smaller batch size for better reliability
      for (let i = 0; i < seatsToCreate.length; i += batchSize) {
        const batch = seatsToCreate.slice(i, i + batchSize)
        try {
          await Seat.insertMany(batch, { ordered: true }) // fail fast so we can detect index problems
        } catch (batchError) {
          if (batchError.code === 11000) { // Duplicate key error
            console.error('[v0] Duplicate key error in batch:', {
              start: i,
              end: i + batchSize,
              error: batchError.writeErrors?.[0]?.err?.errmsg
            })
            // Check for existing seats
            for (const seat of batch) {
              const exists = await Seat.findOne({ 
                eventId: seat.eventId,
                row: seat.row,
                seatNumber: seat.seatNumber
              })
              if (exists) {
                console.error(`[v0] Duplicate seat found: Event ${seat.eventId}, Row ${seat.row}, Seat ${seat.seatNumber}`)
              }
            }
          }
          throw batchError // Re-throw after logging
        }
      }
    }

    try {
      await tryCreateSeats()
      // Verify all seats were created
      const createdSeats = await Seat.countDocuments({ eventId: event._id })
      console.log(`[v0] Created ${createdSeats} seats out of 100 expected`)

      if (createdSeats < 100) {
        throw new Error(`Failed to create all seats. Created ${createdSeats} out of 100`)
      }

      console.log('[v0] Successfully created all 100 seats')
      
      res.json({
        ...event.toObject(),
        seatsCreated: createdSeats,
      })
    } catch (error) {
      console.error('[v0] Error creating seats:', error)
      const message = String(error?.message || '')
      const looksLikeLegacyIndex = message.includes('E11000') && (message.includes('hallId_1_seatNumber_1') || message.includes('hallId'))

      if (looksLikeLegacyIndex) {
        console.warn('[migrate] Detected legacy hallId index conflict. Attempting auto-fix...')
        try {
          // Drop legacy indexes and ensure current ones
          const indexes = await Seat.collection.indexes()
          for (const idx of indexes) {
            if (Object.keys(idx.key || {}).includes('hallId')) {
              try {
                console.warn(`[migrate] Dropping legacy seat index: ${idx.name}`)
                await Seat.collection.dropIndex(idx.name)
              } catch (dropErr) {
                if (!/index not found/i.test(dropErr?.message || '')) {
                  console.warn('[migrate] Failed to drop legacy index on retry:', idx.name, dropErr?.message)
                }
              }
            }
          }
          await Seat.syncIndexes()

          // Retry seat creation once after fixing indexes
          await Seat.deleteMany({ eventId: event._id })
          await tryCreateSeats()

          const createdSeats = await Seat.countDocuments({ eventId: event._id })
          console.log(`[v0] Retry created ${createdSeats} seats after index fix`)

          if (createdSeats >= 100) {
            return res.json({
              ...event.toObject(),
              seatsCreated: createdSeats,
              warning: 'Legacy index was fixed automatically',
            })
          }
        } catch (migrateErr) {
          console.error('[migrate] Auto-fix failed:', migrateErr)
        }
      }

      res.status(500).json({ error: 'Failed to create seats: ' + error.message })
    }
  } catch (err) {
    console.error("[v0] Error creating event:", err)
    res.status(500).json({ error: err.message })
  }
})

app.put("/api/events/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.json(event)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update event layout
app.put("/api/events/:id/layout", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" })
    }

    console.log('[DEBUG] Updating layout with:', req.body)
    const { rows = 10, seatsPerRow = 10, customLayout = false } = req.body

    // Input validation
    if (!rows || !seatsPerRow || rows <= 0 || seatsPerRow <= 0 || rows > 26) {
      return res.status(400).json({ 
        error: 'Invalid layout. Rows must be between 1 and 26, seats must be greater than 0.' 
      })
    }

    // Start with finding and updating the event
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { 
        rows, 
        seatsPerRow, 
        customLayout,
        totalSeats: rows * seatsPerRow
      },
      { new: true }
    )

    if (!event) {
      return res.status(404).json({ error: 'Event not found' })
    }

    try {
      // Delete existing seats first and wait for completion
      console.log(`[v0] Deleting existing seats for event ${event._id}`)
      await Seat.deleteMany({ eventId: event._id })
      
      // Verify deletion
      const remainingSeats = await Seat.countDocuments({ eventId: event._id })
      if (remainingSeats > 0) {
        throw new Error(`Failed to delete all existing seats. ${remainingSeats} seats remain.`)
      }
      console.log('[v0] Successfully deleted all existing seats')
      console.log(`[DEBUG] Deleting existing seats for event ${event._id}`)
      await Seat.deleteMany({ eventId: event._id })

      // Prepare seats for creation
      console.log(`[DEBUG] Creating ${rows}x${seatsPerRow} layout`)
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      const seatsToCreate = []
      
      // Create seats array
      for (let i = 0; i < rows; i++) {
        const rowLabel = alphabet[i]
        for (let j = 1; j <= seatsPerRow; j++) {
          seatsToCreate.push({
            eventId: event._id,
            row: rowLabel,
            seatNumber: j,
            status: 'available'
          })
        }
      }

      // Create seats in smaller batches
      const batchSize = 20
      for (let i = 0; i < seatsToCreate.length; i += batchSize) {
        const batch = seatsToCreate.slice(i, i + batchSize)
        await Seat.insertMany(batch, { ordered: false })
        console.log(`[DEBUG] Created batch of ${batch.length} seats (${i + batch.length}/${seatsToCreate.length})`)
      }

      // Get newly created seats
      const seats = await Seat.find({ eventId: event._id })
      console.log(`[DEBUG] Total seats created: ${seats.length}/${rows * seatsPerRow}`)

      if (seats.length < rows * seatsPerRow) {
        throw new Error(`Only created ${seats.length} out of ${rows * seatsPerRow} seats`)
      }

      // Sort seats for response
      const sortedSeats = seats.sort((a, b) => {
        if (a.row !== b.row) return a.row.localeCompare(b.row)
        return a.seatNumber - b.seatNumber
      })

      // Success!
      res.json({
        event,
        seats: sortedSeats,
        message: 'Layout updated successfully'
      })
    } catch (error) {
      console.error('[DEBUG] Error creating seats:', error)
      // Clean up any partial seat creation
      await Seat.deleteMany({ eventId: event._id })
      throw new Error('Failed to create seats: ' + error.message)
    }
  } catch (err) {
    console.error('[DEBUG] Error in layout update:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/events/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    await Event.findByIdAndDelete(req.params.id)
    await Seat.deleteMany({ eventId: req.params.id })
    res.json({ message: "Event deleted" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= SEAT ROUTES =============

app.get("/api/events/:eventId/seats", async (req, res) => {
  try {
    console.log(`[DEBUG] Fetching seats for event: ${req.params.eventId}`)

    // Get event details
    const event = await Event.findById(req.params.eventId)
    console.log('[DEBUG] Event:', event)

    if (!event) {
      console.log('[DEBUG] Event not found')
      return res.status(404).json({ error: "Event not found" })
    }

    // Get existing seats
    let seats = await Seat.find({ eventId: req.params.eventId })
    console.log(`[DEBUG] Found ${seats.length} existing seats`)

    // Create default 10x10 seats if none exist
    if (seats.length === 0) {
      try {
        console.log('[DEBUG] Creating default 10x10 layout')
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        const seatsToCreate = []

        // Create exactly 10x10 = 100 seats
        for (let i = 0; i < 10; i++) {
          const rowLabel = alphabet[i]
          for (let j = 1; j <= 10; j++) {
            seatsToCreate.push({
              eventId: event._id,
              row: rowLabel,
              seatNumber: j,
              status: 'available'
            })
          }
        }

        // Create seats in batches of 20
        for (let i = 0; i < seatsToCreate.length; i += 20) {
          const batch = seatsToCreate.slice(i, i + 20)
          await Seat.insertMany(batch, { ordered: false })
          console.log(`[DEBUG] Created batch of ${batch.length} seats`)
        }

        // Get all created seats
        seats = await Seat.find({ eventId: req.params.eventId })
        console.log(`[DEBUG] Total seats after creation: ${seats.length}`)

        if (seats.length < 100) {
          throw new Error(`Only created ${seats.length} out of 100 required seats`)
        }

        // Update event to show 10x10 layout
        await Event.findByIdAndUpdate(event._id, {
          rows: 10,
          seatsPerRow: 10,
          totalSeats: 100
        })
      } catch (error) {
        console.error('[DEBUG] Error creating seats:', error)
        return res.status(500).json({ error: 'Failed to create seats: ' + error.message })
      }
    }

    // Return seats sorted by row and seat number
    seats = seats.sort((a, b) => {
      if (a.row !== b.row) return a.row.localeCompare(b.row)
      return a.seatNumber - b.seatNumber
    })

    console.log(`[DEBUG] Returning ${seats.length} seats`)
    res.json(seats)
  } catch (err) {
    console.error('[DEBUG] Error in seats endpoint:', err)
    res.status(500).json({ error: err.message })
  }
})

// ============= BOOKING ROUTES =============

app.post("/api/bookings", authenticateToken, async (req, res) => {
  try {
    const { eventId, seatIds, totalAmount } = req.body

    // Check if seats are available
    const seats = await Seat.find({ _id: { $in: seatIds } })
    const unavailable = seats.filter((s) => s.status !== "available")

    if (unavailable.length > 0) {
      return res.status(400).json({ error: "Some seats are not available" })
    }

    // Update seat status
    await Seat.updateMany({ _id: { $in: seatIds } }, { status: "booked", bookedBy: req.user.userId })

    // Create booking
    const booking = new Booking({
      bookingId: generateBookingId(req.user.userId, eventId),
      userId: req.user.userId,
      eventId,
      seats: seatIds,
      totalAmount,
      status: "confirmed",
    })

    await booking.save()

    // Update event booked seats count
    await Event.findByIdAndUpdate(eventId, { $inc: { bookedSeats: seatIds.length } })

    // Emit real-time update
    io.emit("seatsUpdated", { eventId, seatIds, status: "booked" })

    res.json(booking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/bookings/user/:userId", authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.params.userId })
      .populate("eventId")
      .populate({ path: "seats", select: "row seatNumber" })
    res.json(bookings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete("/api/bookings/:id", authenticateToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
    if (!booking) return res.status(404).json({ error: "Booking not found" })

    // Release seats
    await Seat.updateMany({ _id: { $in: booking.seats } }, { status: "available", bookedBy: null })

    // Update booking status
    booking.status = "cancelled"
    await booking.save()

    // Emit real-time update
    io.emit("seatsUpdated", { eventId: booking.eventId, seatIds: booking.seats, status: "available" })

    res.json({ message: "Booking cancelled" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= ADMIN STATS =============

app.get("/api/admin/stats", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const totalEvents = await Event.countDocuments()
    const totalBookings = await Booking.countDocuments()
    const totalRevenue = await Booking.aggregate([
      { $match: { status: "confirmed" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ])

    res.json({
      totalEvents,
      totalBookings,
      totalRevenue: totalRevenue[0]?.total || 0,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= PAYMENT ROUTES =============

app.post("/api/payments/initiate", authenticateToken, async (req, res) => {
  try {
    const { seatIds, totalAmount, eventId } = req.body

    const order = await razorpay.orders.create({
      amount: totalAmount * 100, // Convert to paise
      currency: "INR",
      receipt: `order_${req.user.userId}_${Date.now()}`,
    })

    res.json({
      orderId: order.id,
      amount: totalAmount,
      key: process.env.RAZORPAY_KEY_ID || "rzp_test_1IA8jJelqMKj7K",
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/payments/verify", authenticateToken, async (req, res) => {
  try {
    const { orderId, paymentId, signature, seatIds, totalAmount, eventId, paymentMethod } = req.body

    // Verify signature with Razorpay
    const crypto = require("crypto")
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "PWV834UI5fwzYW1Zx065wPs1")
      .update(orderId + "|" + paymentId)
      .digest("hex")

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: "Payment verification failed" })
    }

    // Check if seats are available
    const seats = await Seat.find({ _id: { $in: seatIds } })
    const unavailable = seats.filter((s) => s.status !== "available")

    if (unavailable.length > 0) {
      return res.status(400).json({ error: "Some seats are not available" })
    }

    // Update seat status
    await Seat.updateMany({ _id: { $in: seatIds } }, { status: "booked", bookedBy: req.user.userId })

    // Create booking
  const booking = new Booking({
      bookingId: generateBookingId(req.user.userId, eventId),
      userId: req.user.userId,
      eventId,
      seats: seatIds,
      totalAmount,
      status: "pending",
      paymentId,
      paymentMethod,
      paymentStatus: "completed",
      contactName: req.body.contactName,
      contactEmail: req.body.contactEmail,
    })

    await booking.save()

    // Update event booked seats count
    await Event.findByIdAndUpdate(eventId, { $inc: { bookedSeats: seatIds.length } })

    // Emit real-time update
    io.emit("seatsUpdated", { eventId, seatIds, status: "booked" })

    res.json({
      success: true,
      booking,
      message: "Payment verified successfully",
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post("/api/payments/demo", authenticateToken, async (req, res) => {
  try {
    const { seatIds, totalAmount, eventId, paymentMethod, contactName, contactEmail } = req.body

    // Check if seats are available
    const seats = await Seat.find({ _id: { $in: seatIds } })
    const unavailable = seats.filter((s) => s.status !== "available")

    if (unavailable.length > 0) {
      return res.status(400).json({ error: "Some seats are not available" })
    }

    // Update seat status
    await Seat.updateMany({ _id: { $in: seatIds } }, { status: "booked", bookedBy: req.user.userId })

    // Create booking
    const booking = new Booking({
      bookingId: generateBookingId(req.user.userId, eventId),
      userId: req.user.userId,
      eventId,
      seats: seatIds,
      totalAmount,
      status: "pending",
      paymentId: `demo_${Date.now()}`,
      paymentMethod: paymentMethod || "demo",
      paymentStatus: "completed",
      contactName,
      contactEmail,
    })

    await booking.save()

    // Update event booked seats count
    await Event.findByIdAndUpdate(eventId, { $inc: { bookedSeats: seatIds.length } })

    // Emit real-time update
    io.emit("seatsUpdated", { eventId, seatIds, status: "booked" })

    res.json({
      success: true,
      booking,
      message: "Demo payment successful - Booking confirmed",
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= ADMIN ENDPOINTS =============

app.post("/api/admin/bookings/:bookingId/send-ticket", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const booking = await Booking.findById(req.params.bookingId).populate("userId eventId seats")

    if (!booking) return res.status(404).json({ error: "Booking not found" })

    if (booking.ticketSentToEmail) return res.status(400).json({ error: "Ticket already sent" })

    const user = await User.findById(booking.userId)
    const event = booking.eventId

    // Generate Ticket Details
    const ticketDetails = `
      <h2>Your Event Ticket - TicketHub</h2>
      <p><strong>Booking ID:</strong> ${booking._id}</p>
      <p><strong>Event:</strong> ${event.title}</p>
      <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
      <p><strong>Time:</strong> ${event.time}</p>
      <p><strong>Seats:</strong> ${booking.seats.length} seats</p>
      <p><strong>Total Amount Paid:</strong> ₹${booking.totalAmount}</p>
      <p><strong>Payment Method:</strong> ${booking.paymentMethod}</p>
      <p><strong>Status:</strong> CONFIRMED</p>
      <hr>
      <p>Please show this email at the venue with your Booking ID to collect your tickets.</p>
    `

    const toEmail = booking.contactEmail || user?.email
    const displayName = booking.contactName || user?.name || 'Customer'
    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: toEmail,
      subject: `TicketHub Booking Confirmation - ${event.title}`,
      html: ticketDetails,
    }

    // Always confirm booking in DB, regardless of email status
    let emailSent = false
    if (EMAIL_ENABLED) {
      try {
        await emailService.sendMail(mailOptions)
        emailSent = true
      } catch (emailErr) {
        console.warn('[email] Failed to send ticket email:', emailErr?.message)
      }
    }

    booking.status = "confirmed"
    booking.ticketSentToEmail = emailSent
    await booking.save()

    if (!EMAIL_ENABLED) {
      return res.json({ message: "Booking approved without email (email disabled)." })
    }

    if (emailSent) {
      return res.json({ message: "Ticket sent to user email successfully" })
    }

    return res.json({ message: "Booking approved, but email could not be sent right now." })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/admin/bookings", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Unauthorized" })

    const bookings = await Booking.find()
      .populate("userId eventId")
      .populate({ path: "seats", select: "row seatNumber" })
      .sort({ createdAt: -1 })

    res.json(bookings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= SEEDING DATA =============

app.get("/api/seed", async (req, res) => {
  try {
    // Check if data already exists
    const existingHalls = await Hall.countDocuments()
    if (existingHalls > 0) {
      return res.json({ message: "Data already seeded" })
    }

    // Create halls
    const hall1 = await Hall.create({
      name: "PVR Cinemas - Delhi",
      city: "Delhi",
      totalSeats: 100,
      rows: 10,
      seatsPerRow: 10,
      seatLayout: [{ row: "A", seats: [1, 2] }], // Example custom seat layout
    })

    const hall2 = await Hall.create({
      name: "INOX - Mumbai",
      city: "Mumbai",
      totalSeats: 80,
      rows: 8,
      seatsPerRow: 10,
      seatLayout: [{ row: "B", seats: [3, 4] }], // Example custom seat layout
    })

    // Create admin user
    const adminPassword = await bcrypt.hash("admin123", 10)
    await User.create({
      name: "Admin",
      email: "admin@tickethub.com",
      password: adminPassword,
      role: "admin",
    })

    // Create sample events
    const event1 = await Event.create({
      title: "Avengers: Endgame",
      description: "Epic superhero action movie",
      venue: hall1.name,
      hallId: hall1._id,
      date: new Date(2024, 11, 20),
      time: "19:30",
      price: 250,
      totalSeats: 100,
      image: "https://via.placeholder.com/300x400?text=Avengers",
    })

    const event2 = await Event.create({
      title: "Dune: Part Two",
      description: "Science fiction epic",
      venue: hall2.name,
      hallId: hall2._id,
      date: new Date(2024, 11, 25),
      time: "18:00",
      price: 300,
      totalSeats: 80,
      image: "https://via.placeholder.com/300x400?text=Dune",
    })

    // Create seats for events
    for (let i = 0; i < 10; i++) {
      const row = String.fromCharCode(65 + i)
      for (let j = 1; j <= 10; j++) {
        await Seat.create({
          eventId: event1._id,
          row,
          seatNumber: j,
        })
      }
    }

    for (let i = 0; i < 8; i++) {
      const row = String.fromCharCode(65 + i)
      for (let j = 1; j <= 10; j++) {
        await Seat.create({
          eventId: event2._id,
          row,
          seatNumber: j,
        })
      }
    }

    res.json({ message: "Data seeded successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============= SOCKET.IO (REAL-TIME) =============

io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  socket.on("joinEvent", (eventId) => {
    socket.join(`event-${eventId}`)
  })

  socket.on("seatSelected", (data) => {
    io.to(`event-${data.eventId}`).emit("seatUpdated", data)
  })

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)
  })
})

// ============= START SERVER =============

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
