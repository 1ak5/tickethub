const API_URL = "http://localhost:5000/api"
const WS_URL = "http://localhost:5000"

let currentUser = null
let currentEvent = null
let selectedSeats = []
const socket = null

// Initialize app
window.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token")
  if (token) {
    const user = JSON.parse(localStorage.getItem("user") || "{}")
    currentUser = user
    updateNavBar()
  }

  connectWebSocket()
  app.showPage("home")
  app.updateBookingsBadge?.()
  
  // Set admin mode on page load if admin user
  const appShell = document.querySelector('.app-shell')
  const adminSidebarGlobal = document.getElementById('adminSidebarGlobal')
  if (currentUser && currentUser.role === 'admin') {
    if (appShell) {
      appShell.classList.add('admin-mode')
    }
    if (adminSidebarGlobal) {
      adminSidebarGlobal.style.display = "block"
    }
  }
})

const app = {
  // Navigation
  showPage(page) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"))
    const pageElement = document.getElementById(page + "Page")
    if (!pageElement) {
      console.error(`Page ${page}Page not found`)
      return
    }
    pageElement.classList.add("active")

    // Highlight current nav (supports both legacy .nav-link and new .app-nav-link)
    document.querySelectorAll(".nav-link, .app-nav-link").forEach((link) => link.classList.remove("active"))
    document.querySelector(`[data-page="${page}"]`)?.classList.add("active")

    // Admin mode layout: hide normal sidebar for admin users always
    const appShell = document.querySelector('.app-shell')
    if (appShell) {
      if (currentUser && currentUser.role === 'admin') {
        appShell.classList.add('admin-mode')
      } else {
        appShell.classList.remove('admin-mode')
      }
    }

    if (page === "events") this.loadEvents()
    if (page === "bookings") this.loadBookings()
    if (page === "admin") {
      this.loadAdminData()
      // Set default tab to stats if no tab is active
      const activeTab = document.querySelector('.admin-tab-content.active')
      if (!activeTab) {
        this.switchAdminTab('stats')
      }
    }
  },

  showAdminTab(tab) {
    this.showPage('admin')
    setTimeout(() => {
      this.switchAdminTab(tab)
      // Update global admin sidebar active state
      document.querySelectorAll('.admin-sidebar-global .admin-nav-link').forEach(link => {
        link.classList.remove('active')
        if (link.getAttribute('data-admin-tab') === tab) {
          link.classList.add('active')
        }
      })
    }, 50)
  },

  // Auth
  async handleLogin(e) {
    e.preventDefault()
    const email = document.getElementById("loginEmail").value
    const password = document.getElementById("loginPassword").value

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      localStorage.setItem("token", data.token)
      localStorage.setItem("user", JSON.stringify(data.user))
      currentUser = data.user

      updateNavBar()
      this.showNotification("Logged in successfully!", "success")
      this.showPage("home")
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async handleRegister(e) {
    e.preventDefault()
    const name = document.getElementById("regName").value
    const email = document.getElementById("regEmail").value
    const password = document.getElementById("regPassword").value
    const confirm = document.getElementById("regConfirm").value

    if (password !== confirm) {
      this.showNotification("Passwords do not match", "error")
      return
    }

    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      localStorage.setItem("token", data.token)
      localStorage.setItem("user", JSON.stringify(data.user))
      currentUser = data.user

      updateNavBar()
      this.showNotification("Account created successfully!", "success")
      this.showPage("home")
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  logout() {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    currentUser = null
    updateNavBar()
    this.showPage("home")
    this.showNotification("Logged out successfully!", "success")
  },

  // Events
  async loadEvents() {
    try {
      const res = await fetch(`${API_URL}/events`)
      const events = await res.json()

      const grid = document.getElementById("eventsGrid")
      grid.innerHTML = ""

      events.forEach((event) => {
        const card = document.createElement("div")
        card.className = "event-card"
        card.innerHTML = `
                    <img src="${event.image}" alt="${event.title}" class="event-card-image">
                    <div class="event-card-body">
                        <h3 class="event-card-title">${event.title}</h3>
                        <p class="event-card-venue">${event.venue || event.hallId?.name || event.hallId?.city || ''}</p>
                        <p class="event-card-date">${new Date(event.date).toLocaleDateString()}</p>
                        <div class="event-card-footer">
                            <span class="event-card-price">₹${event.price}</span>
                            <button onclick="app.viewEventDetails('${event._id}')" class="btn btn-primary">Book Now</button>
                        </div>
                    </div>
                `
        grid.appendChild(card)
      })
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async viewEventDetails(eventId) {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}`)
      currentEvent = await res.json()

      document.getElementById("eventTitle").textContent = currentEvent.title
      document.getElementById("eventDescription").textContent = currentEvent.description
      document.getElementById("eventImage").src = currentEvent.image
      document.getElementById("eventDate").textContent = new Date(currentEvent.date).toLocaleDateString()
      document.getElementById("eventTime").textContent = currentEvent.time
      document.getElementById("eventVenue").textContent = currentEvent.venue || currentEvent.hallId?.name || currentEvent.hallId?.city || ''
      document.getElementById("eventPrice").textContent = currentEvent.price
      document.getElementById("availableSeats").textContent = currentEvent.totalSeats - currentEvent.bookedSeats

      this.loadSeats()
      this.showPage("eventDetails")
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  filterEvents() {
    const search = document.getElementById("searchEvents").value.toLowerCase()
    const city = document.getElementById("cityFilter").value

    const cards = document.querySelectorAll(".event-card")
    cards.forEach((card) => {
      const title = card.querySelector(".event-card-title").textContent.toLowerCase()
      const venue = card.querySelector(".event-card-venue").textContent

      const matchSearch = title.includes(search)
      const matchCity = !city || venue.includes(city)

      card.style.display = matchSearch && matchCity ? "block" : "none"
    })
  },

  // Seating
  async loadSeats() {
    if (!currentEvent) {
      this.showNotification("No event selected", "error")
      return
    }

    try {
      // Show seating page immediately
      this.showPage("seating")

      console.log('[DEBUG] Loading seats for event:', currentEvent._id)

      // First get event details to ensure we have hall info
      const eventRes = await fetch(`${API_URL}/events/${currentEvent._id}`)
      if (!eventRes.ok) {
        throw new Error('Failed to fetch event details')
      }
      const eventDetails = await eventRes.json()
      console.log('[DEBUG] Event details:', eventDetails)
      
      currentEvent = eventDetails // Update current event with hall details

      // Show edit layout button only for admin
      const layoutActions = document.getElementById("layoutActions")
      if (currentUser && currentUser.role === "admin") {
        layoutActions.style.display = "block"
        document.getElementById("rowsInput").value = currentEvent.rows || 10
        document.getElementById("seatsInput").value = currentEvent.seatsPerRow || 10
      } else {
        layoutActions.style.display = "none"
      }

      if (!currentEvent.hallId) {
        document.getElementById("seatsArea").innerHTML =
          '<p style="text-align:center; padding: 2rem; color: #666;">No hall information available for this event</p>'
        this.showNotification("No hall information available", "warning")
        return
      }

      // Then fetch and render seats
      const res = await fetch(`${API_URL}/events/${currentEvent._id}/seats`)
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to load seats')
      }
      
      const seats = await res.json()
      console.log('[DEBUG] Loaded seats:', seats)

      if (!seats || !Array.isArray(seats) || seats.length === 0) {
        document.getElementById("seatsArea").innerHTML =
          '<p style="text-align:center; padding: 2rem; color: #666;">No seats available</p>'
        this.showNotification("No seats available for this event", "warning")
        return
      }

      const area = document.getElementById("seatsArea")
      area.innerHTML = ""
      selectedSeats = []

      // Add hall info with more details
      const hallInfo = document.createElement("div")
      hallInfo.className = "hall-info"
      hallInfo.innerHTML = `
        <h3>${currentEvent.hallId.name}</h3>
        <p class="hall-details">
          <span>Layout: ${currentEvent.hallId.rows} rows × ${currentEvent.hallId.seatsPerRow} seats per row</span>
          <span>Total Seats: ${currentEvent.hallId.rows * currentEvent.hallId.seatsPerRow}</span>
          <span>Available Seats: ${seats.filter(s => s.status === 'available').length}</span>
        </p>
      `
      area.appendChild(hallInfo)

      // Create seats container
      const seatsContainer = document.createElement("div")
      seatsContainer.className = "seats-container"
      
      // Add screen
      const screen = document.createElement("div")
      screen.className = "screen"
      screen.innerHTML = "SCREEN"
      seatsContainer.appendChild(screen)

      // Group seats by row
      const rows = {}
      seats.forEach((seat) => {
        if (!rows[seat.row]) rows[seat.row] = []
        rows[seat.row].push(seat)
      })

      // Render each row with seats
      Object.keys(rows)
        .sort()
        .forEach((row) => {
          const rowDiv = document.createElement("div")
          rowDiv.className = "seats-row"

          // Row label
          const label = document.createElement("div")
          label.className = "row-label"
          label.textContent = row
          rowDiv.appendChild(label)

          // Render seats in this row
          rows[row]
            .sort((a, b) => a.seatNumber - b.seatNumber)
            .forEach((seat) => {
              const seatDiv = document.createElement("div")
              seatDiv.className = `seat seat-${seat.status}`
              seatDiv.textContent = seat.seatNumber
              seatDiv.title = `${row}${seat.seatNumber}`
              seatDiv.dataset.seatId = seat._id

              // Make available seats clickable
              if (seat.status === "available") {
                seatDiv.style.cursor = "pointer"
                seatDiv.onclick = () => this.toggleSeat(seat._id, seatDiv)
              }

              rowDiv.appendChild(seatDiv)
            })

          seatsContainer.appendChild(rowDiv)
        })

      area.appendChild(seatsContainer)

      this.updateBookingSummary()
    } catch (err) {
      document.getElementById("seatsArea").innerHTML =
        `<p style="text-align:center; padding: 2rem; color: red;">Error loading seats: ${err.message}</p>`
      this.showNotification(`Error loading seats: ${err.message}`, "error")
    }
  },

  toggleSeat(seatId, element) {
    const index = selectedSeats.indexOf(seatId)
    if (index > -1) {
      selectedSeats.splice(index, 1)
      element.classList.remove("seat-selected")
      element.classList.add("seat-available")
    } else {
      selectedSeats.push(seatId)
      element.classList.remove("seat-available")
      element.classList.add("seat-selected")
    }

    this.updateBookingSummary()
  },

  updateBookingSummary() {
    document.getElementById("selectedSeatsCount").textContent = selectedSeats.length
    document.getElementById("pricePerSeat").textContent = currentEvent.price
    const total = selectedSeats.length * currentEvent.price
    document.getElementById("totalAmount").textContent = total
  },

  editLayout() {
    if (!currentUser || currentUser.role !== "admin") {
      this.showNotification("Only admin can edit layout", "error")
      return
    }

    document.getElementById("layoutEditor").style.display = "block"
    document.getElementById("layoutActions").style.display = "none"
    document.getElementById("seatsArea").style.display = "none"
  },

  async saveLayout() {
    try {
      const rows = parseInt(document.getElementById("rowsInput").value)
      const seatsPerRow = parseInt(document.getElementById("seatsInput").value)

      if (rows < 1 || rows > 26 || seatsPerRow < 1 || seatsPerRow > 20) {
        this.showNotification("Invalid layout dimensions", "error")
        return
      }

      // Update event with new layout
      const res = await fetch(`${API_URL}/events/${currentEvent._id}/layout`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          rows,
          seatsPerRow,
          customLayout: true
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }

      this.showNotification("Layout updated successfully", "success")
      document.getElementById("layoutEditor").style.display = "none"
      document.getElementById("layoutActions").style.display = "block"
      document.getElementById("seatsArea").style.display = "block"
      
      // Reload seats with new layout immediately
      await this.loadSeats()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  cancelLayoutEdit() {
    document.getElementById("layoutEditor").style.display = "none"
    document.getElementById("layoutActions").style.display = "block"
    document.getElementById("seatsArea").style.display = "block"
  },

  proceedToPayment() {
    if (selectedSeats.length === 0) {
      this.showNotification("Please select at least one seat", "warning")
      return
    }

    if (!currentUser) {
      this.showNotification("Please login to book seats", "warning")
      this.showPage("login")
      return
    }

    const total = selectedSeats.length * currentEvent.price
    document.getElementById("paymentSeats").textContent = selectedSeats.length
    document.getElementById("paymentTotal").textContent = total

    this.showPage("payment")
    // Prefill contact details if logged in
    const n = document.getElementById("contactName")
    const e = document.getElementById("contactEmail")
    if (n && e && currentUser) {
      n.value = currentUser.name || ''
      e.value = currentUser.email || ''
    }
  },

  async handlePayment(e) {
    e.preventDefault()

    if (selectedSeats.length === 0) {
      this.showNotification("No seats selected", "error")
      return
    }

    try {
      const total = selectedSeats.length * currentEvent.price
      const paymentMethod = document.getElementById("paymentMethod").value
      const contactName = document.getElementById("contactName").value
      const contactEmail = document.getElementById("contactEmail").value

      const isDemoPayment = paymentMethod === "demo"

      if (isDemoPayment) {
        // Use demo payment endpoint
        const demoRes = await fetch(`${API_URL}/payments/demo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            seatIds: selectedSeats,
            totalAmount: total,
            eventId: currentEvent._id,
            paymentMethod: "demo",
            contactName,
            contactEmail,
          }),
        })

        const booking = await demoRes.json()
        if (!demoRes.ok) throw new Error(booking.error)

        this.showNotification(
          "Payment successful! Booking confirmed. Admin will send ticket to your email shortly.",
          "success",
        )
        selectedSeats = []
        this.showPage("home")
        this.updateBookingsBadge()
        return
      }

      // Original Razorpay flow for other payment methods
      const initRes = await fetch(`${API_URL}/payments/initiate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          seatIds: selectedSeats,
          totalAmount: total,
          eventId: currentEvent._id,
        }),
      })

      const orderData = await initRes.json()
      if (!initRes.ok) throw new Error(orderData.error)

      const options = {
        key: orderData.key,
        amount: orderData.amount * 100,
        currency: "INR",
        order_id: orderData.orderId,
        description: `Booking for ${currentEvent.title}`,
        prefill: {
          name: currentUser.name,
          email: currentUser.email,
        },
        method: paymentMethod === "all" ? {} : { [paymentMethod]: true },
        handler: async (response) => {
          const verifyRes = await fetch(`${API_URL}/payments/verify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              orderId: orderData.orderId,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
              seatIds: selectedSeats,
              totalAmount: total,
              eventId: currentEvent._id,
              paymentMethod: paymentMethod,
              contactName,
              contactEmail,
            }),
          })

          const booking = await verifyRes.json()
          if (!verifyRes.ok) throw new Error(booking.error)

          this.showNotification(
            "Payment successful! Booking confirmed. Admin will send ticket to your email shortly.",
            "success",
          )
          selectedSeats = []
          this.showPage("home")
          this.updateBookingsBadge()
        },
        modal: {
          ondismiss: () => {
            this.showNotification("Payment cancelled", "error")
          },
        },
      }

      if (typeof window.Razorpay === "undefined") {
        const script = document.createElement("script")
        script.src = "https://checkout.razorpay.com/v1/checkout.js"
        script.onload = () => {
          new window.Razorpay(options).open()
        }
        document.head.appendChild(script)
      } else {
        new window.Razorpay(options).open()
      }
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  // Bookings
  async loadBookings() {
    if (!currentUser) {
      this.showNotification("Please login to view your bookings", "warning")
      this.showPage("login")
      return
    }

    try {
      const res = await fetch(`${API_URL}/bookings/user/${currentUser.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const bookings = await res.json()
      const list = document.getElementById("bookingsList")
      list.innerHTML = ""

      if (bookings.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#666;">No bookings yet</p>'
        return
      }

      bookings.forEach((booking) => {
        const item = document.createElement("div")
        item.className = "booking-item"
        const seatLabels = (booking.seats || []).map(s => `${s.row}${s.seatNumber}`).join(', ')
        const venue = booking.eventId?.venue || booking.eventId?.hallId?.name || booking.eventId?.hallId?.city || ''
        item.innerHTML = `
                    <div class="booking-info">
                        <h3>${booking.eventId?.title}</h3>
                        <div class="booking-details-card">
                          <p><strong>Venue:</strong> ${venue}</p>
                          <p><strong>Seats:</strong> ${seatLabels || booking.seats?.length || 0}</p>
                          <p><strong>Booking Date:</strong> ${new Date(booking.createdAt).toLocaleDateString()}</p>
                          <p><strong>Event Date:</strong> ${booking.eventId?.date ? new Date(booking.eventId.date).toLocaleDateString() : ''}</p>
                        </div>
                        <p><strong>Total Amount:</strong> ₹${booking.totalAmount}</p>
                    </div>
                    <div>
                        <span class="booking-status ${booking.status}">${booking.status.toUpperCase()}</span>
                        ${booking.status !== "cancelled" ? `<button onclick="app.cancelBooking('${booking._id}')" class="btn btn-danger" style="margin-top:1rem;">Cancel</button>` : ""}
                    </div>
                `
        list.appendChild(item)
      })
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async cancelBooking(bookingId) {
    if (!confirm("Are you sure you want to cancel this booking?")) return

    try {
      const res = await fetch(`${API_URL}/bookings/${bookingId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      this.showNotification("Booking cancelled successfully", "success")
      this.loadBookings()
      this.updateBookingsBadge()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  // Admin
  async loadAdminData() {
    if (!currentUser || currentUser.role !== "admin") {
      this.showNotification("Unauthorized", "error")
      this.showPage("home")
      return
    }

    try {
      const [statsRes, eventsRes, hallsRes, bookingsRes] = await Promise.all([
        fetch(`${API_URL}/admin/stats`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }),
        fetch(`${API_URL}/events`),
        fetch(`${API_URL}/halls`),
        fetch(`${API_URL}/admin/bookings`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }),
      ])

      const stats = await statsRes.json()
      const events = await eventsRes.json()
      const halls = await hallsRes.json()
      const bookings = await bookingsRes.json()

      // Update main stats
      document.getElementById("totalEventsCount").textContent = stats.totalEvents
      document.getElementById("totalBookingsCount").textContent = stats.totalBookings
      document.getElementById("totalRevenueCount").textContent = stats.totalRevenue || 0

      // Calculate additional stats
      const pendingBookings = bookings.filter(b => b.status === 'pending').length
      const confirmedBookings = bookings.filter(b => b.status === 'confirmed')
      const avgBookingValue = confirmedBookings.length > 0 
        ? Math.round(confirmedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0) / confirmedBookings.length)
        : 0

      // Upcoming events (next 7 days)
      const today = new Date()
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      const upcomingEvents = events.filter(e => {
        const eventDate = new Date(e.date)
        return eventDate >= today && eventDate <= nextWeek
      })

      document.getElementById("pendingBookingsCount").textContent = pendingBookings
      document.getElementById("upcomingEventsCount").textContent = upcomingEvents.length
      document.getElementById("avgBookingValue").textContent = avgBookingValue

      // Load dashboard widgets
      this.loadRecentBookings(bookings)
      this.loadUpcomingEvents(upcomingEvents)
      this.loadPopularEvents(events, bookings)

      // Load events table
      const eventsTBody = document.getElementById("eventsTableBody")
      eventsTBody.innerHTML = ""
      events.forEach((event) => {
        const row = document.createElement("tr")
        row.className = "event-row-clickable"
        row.style.cursor = "pointer"
        row.onclick = (e) => {
          // Don't open if clicking on delete button
          if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return
          }
          app.viewEventDetails(event._id)
        }
        row.innerHTML = `
                    <td>${event.title}</td>
                    <td>${event.hallId?.name}</td>
                    <td>${new Date(event.date).toLocaleDateString()}</td>
                    <td>₹${event.price}</td>
                    <td>${event.bookedSeats}/${event.totalSeats}</td>
                    <td>
                        <button onclick="event.stopPropagation(); app.deleteEvent('${event._id}')" class="btn btn-danger">Delete</button>
                    </td>
                `
        eventsTBody.appendChild(row)
      })

      // Load halls table
      const hallsTBody = document.getElementById("hallsTableBody")
      hallsTBody.innerHTML = ""
      halls.forEach((hall) => {
        const row = document.createElement("tr")
        row.innerHTML = `
                    <td>${hall.name}</td>
                    <td>${hall.city}</td>
                    <td>${hall.totalSeats}</td>
                    <td>${hall.rows} x ${hall.seatsPerRow}</td>
                    <td>
                        <button onclick="app.deleteHall('${hall._id}')" class="btn btn-danger">Delete</button>
                    </td>
                `
        hallsTBody.appendChild(row)
      })

      // Load hall select for event creation
      const hallSelect = document.getElementById("hallSelectInput")
      hallSelect.innerHTML = '<option value="">Select Hall</option>'
      halls.forEach((hall) => {
        const option = document.createElement("option")
        option.value = hall._id
        option.textContent = `${hall.name} (${hall.totalSeats} seats)`
        hallSelect.appendChild(option)
      })

      // Load admin bookings
      this.loadAdminBookings()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  loadRecentBookings(bookings) {
    const list = document.getElementById("recentBookingsList")
    if (!list) return

    const recentBookings = bookings
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5)

    if (recentBookings.length === 0) {
      list.innerHTML = '<p class="empty-text">No bookings yet</p>'
      return
    }

    list.innerHTML = recentBookings.map(booking => {
      const contactName = booking.contactName || booking.userId?.name || 'Unknown'
      const eventTitle = booking.eventId?.title || 'Event Deleted'
      const date = new Date(booking.createdAt).toLocaleDateString()
      const statusClass = booking.status || 'pending'
      return `
        <div class="recent-item">
          <div class="recent-item-content">
            <h4>${eventTitle}</h4>
            <p class="recent-item-meta">${contactName} • ₹${booking.totalAmount}</p>
            <p class="recent-item-date">${date}</p>
          </div>
          <span class="status ${statusClass}">${statusClass}</span>
        </div>
      `
    }).join('')
  },

  loadUpcomingEvents(events) {
    const list = document.getElementById("upcomingEventsList")
    if (!list) return

    const sortedEvents = events
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5)

    if (sortedEvents.length === 0) {
      list.innerHTML = '<p class="empty-text">No upcoming events</p>'
      return
    }

    list.innerHTML = sortedEvents.map(event => {
      const date = new Date(event.date).toLocaleDateString()
      const occupancy = event.totalSeats > 0 
        ? Math.round((event.bookedSeats / event.totalSeats) * 100) 
        : 0
      return `
        <div class="recent-item clickable" onclick="app.viewEventDetails('${event._id}')">
          <div class="recent-item-content">
            <h4>${event.title}</h4>
            <p class="recent-item-meta">${event.hallId?.name || event.venue} • ${date}</p>
            <div class="occupancy-bar">
              <div class="occupancy-fill" style="width: ${occupancy}%"></div>
              <span class="occupancy-text">${occupancy}% booked</span>
            </div>
          </div>
        </div>
      `
    }).join('')
  },

  loadPopularEvents(events, bookings) {
    const list = document.getElementById("popularEventsList")
    if (!list) return

    // Count bookings per event
    const eventBookingCounts = {}
    bookings.forEach(booking => {
      const eventId = booking.eventId?._id || booking.eventId
      if (eventId) {
        eventBookingCounts[eventId] = (eventBookingCounts[eventId] || 0) + 1
      }
    })

    // Sort events by booking count
    const popularEvents = events
      .map(event => ({
        ...event,
        bookingCount: eventBookingCounts[event._id] || 0
      }))
      .sort((a, b) => b.bookingCount - a.bookingCount)
      .slice(0, 5)

    if (popularEvents.length === 0 || popularEvents.every(e => e.bookingCount === 0)) {
      list.innerHTML = '<p class="empty-text">No popular events yet</p>'
      return
    }

    list.innerHTML = popularEvents.map(event => {
      const date = new Date(event.date).toLocaleDateString()
      return `
        <div class="recent-item clickable" onclick="app.viewEventDetails('${event._id}')">
          <div class="recent-item-content">
            <h4>${event.title}</h4>
            <p class="recent-item-meta">${event.hallId?.name || event.venue} • ${date}</p>
            <p class="popular-badge">${event.bookingCount} bookings</p>
          </div>
        </div>
      `
    }).join('')
  },

  switchAdminTab(tab) {
    document.querySelectorAll(".admin-tab-content").forEach((el) => el.classList.remove("active"))
    document.querySelectorAll(".admin-nav-link").forEach((el) => el.classList.remove("active"))

    const tabElement = document.getElementById(tab + "Tab")
    if (tabElement) {
      tabElement.classList.add("active")
    }
    
    if (event && event.currentTarget) {
      event.currentTarget.classList.add("active")
    } else {
      // Mark the matching nav link active in both admin sidebars
      const btns = document.querySelectorAll('.admin-nav-link')
      btns.forEach((b) => {
        if (b.getAttribute('data-admin-tab') === tab || b.textContent.trim().toLowerCase().includes(tab)) {
          b.classList.add('active')
        }
      })
    }
  },

  showCreateEventForm() {
    document.getElementById("eventFormContainer").style.display = "block"
    this.loadAdminData()
  },

  hideCreateEventForm() {
    document.getElementById("eventFormContainer").style.display = "none"
  },

  async handleCreateEvent(e) {
    e.preventDefault()

    const title = document.getElementById("eventTitleInput").value
    const description = document.getElementById("eventDescInput").value
    const venue = document.getElementById("eventVenueInput").value
    const hallId = document.getElementById("hallSelectInput").value
    const date = document.getElementById("eventDateInput").value
    const time = document.getElementById("eventTimeInput").value
    const price = document.getElementById("eventPriceInput").value
    const image = document.getElementById("eventImageInput").value

    try {
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          title,
          description,
          venue,
          hallId,
          date,
          time,
          price,
          image: image || "https://via.placeholder.com/300x400?text=Event",
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      this.showNotification("Event created successfully!", "success")
      this.hideCreateEventForm()
      e.target.reset()
      this.loadAdminData()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async deleteEvent(eventId) {
    if (!confirm("Are you sure you want to delete this event?")) return

    try {
      const res = await fetch(`${API_URL}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!res.ok) throw new Error("Failed to delete event")

      this.showNotification("Event deleted successfully", "success")
      this.loadAdminData()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  showCreateHallForm() {
    document.getElementById("hallFormContainer").style.display = "block"
  },

  hideCreateHallForm() {
    document.getElementById("hallFormContainer").style.display = "none"
  },

  async handleCreateHall(e) {
    e.preventDefault()

    const name = document.getElementById("hallNameInput").value
    const city = document.getElementById("hallCityInput").value
    const rows = document.getElementById("hallRowsInput").value
    const seatsPerRow = document.getElementById("hallSeatsInput").value

    try {
      const res = await fetch(`${API_URL}/halls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          name,
          city,
          rows: Number.parseInt(rows),
          seatsPerRow: Number.parseInt(seatsPerRow),
          totalSeats: rows * seatsPerRow,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      this.showNotification("Hall created successfully!", "success")
      this.hideCreateHallForm()
      e.target.reset()
      this.loadAdminData()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async deleteHall(hallId) {
    if (!confirm("Are you sure you want to delete this hall?")) return

    try {
      const res = await fetch(`${API_URL}/halls/${hallId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!res.ok) throw new Error("Failed to delete hall")

      this.showNotification("Hall deleted successfully", "success")
      this.loadAdminData()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async loadAdminBookings() {
    try {
      const res = await fetch(`${API_URL}/admin/bookings`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const bookings = await res.json()
      const tbody = document.getElementById("bookingsTableBody")
      tbody.innerHTML = ""

      bookings.forEach((booking) => {
        const row = document.createElement("tr")
        const seatLabels = Array.isArray(booking.seats) ? (booking.seats || []).map(s => `${s.row ?? ''}${s.seatNumber ?? ''}`.trim()).filter(Boolean).join(', ') : ''
        const unitPrice = booking.eventId?.price || 0
        const derivedCount = unitPrice > 0 ? Math.max(1, Math.round((booking.totalAmount || 0) / unitPrice)) : (Array.isArray(booking.seats) ? booking.seats.length : 0)
        const seatsDisplay = seatLabels && seatLabels.length > 0 ? seatLabels : `${derivedCount} ${derivedCount === 1 ? 'seat' : 'seats'}`
        const contactName = booking.contactName || booking.userId?.name || ''
        const contactEmail = booking.contactEmail || booking.userId?.email || ''
        row.innerHTML = `
          <td>${contactName}<br><small>${contactEmail}</small></td>
          <td>${booking.eventId?.title}</td>
          <td>${seatsDisplay}</td>
          <td>₹${booking.totalAmount}</td>
          <td>${booking.paymentMethod}</td>
          <td><span class="status ${booking.status}">${booking.status}</span></td>
          <td>
            ${booking.status === 'cancelled'
              ? `<span class=\"status cancelled\">N/A</span>`
              : (!booking.ticketSentToEmail
                ? `<button onclick=\"app.sendTicketEmail('${booking._id}')\" class=\"btn btn-success btn-sm\">Approve & Send Ticket</button>`
                : `<span class=\"status confirmed\">Sent</span>`)}
          </td>
        `
        tbody.appendChild(row)
      })
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  async sendTicketEmail(bookingId) {
    try {
      const res = await fetch(`${API_URL}/admin/bookings/${bookingId}/send-ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      this.showNotification("Ticket sent to user email successfully!", "success")
      this.loadAdminBookings()
    } catch (err) {
      this.showNotification(err.message, "error")
    }
  },

  // Utility
  showNotification(message, type = "success") {
    const notif = document.getElementById("notification")
    notif.textContent = message
    notif.className = `notification show ${type}`

    setTimeout(() => {
      notif.classList.remove("show")
    }, 3000)
  },
  
  async updateBookingsBadge() {
    try {
      const badge = document.getElementById("bookingsStatusBadge")
      if (!badge) return
      badge.classList.remove("pending", "confirmed", "cancelled")

      if (!currentUser) {
        badge.textContent = "0"
        badge.title = "Login to view bookings"
        return
      }

      const res = await fetch(`${API_URL}/bookings/user/${currentUser.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const bookings = await res.json()

      const count = bookings.length || 0
      badge.textContent = String(count)

      if (count > 0) {
        // Use the most recent booking status for badge color
        const latest = bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
        const status = (latest.status || '').toLowerCase()
        if (status === 'pending') badge.classList.add('pending')
        if (status === 'confirmed') badge.classList.add('confirmed')
        if (status === 'cancelled') badge.classList.add('cancelled')
        badge.title = `Latest booking: ${latest.status}`
      } else {
        badge.title = 'No bookings yet'
      }
    } catch (e) {
      // Silent fail for badge
    }
  }
}

function updateNavBar() {
  const loginBtn = document.getElementById("loginBtn")
  const logoutBtn = document.getElementById("logoutBtn")
  const bookingsNav = document.getElementById("bookingsNav")
  const adminNav = document.getElementById("adminNav")
  const appShell = document.querySelector('.app-shell')
  const adminSidebarGlobal = document.getElementById('adminSidebarGlobal')

  if (currentUser) {
    loginBtn.style.display = "none"
    logoutBtn.style.display = "inline-block"
    bookingsNav.style.display = "inline-block"

    if (currentUser.role === "admin") {
      adminNav.style.display = "inline-block"
      // Hide normal sidebar and show admin sidebar for admin users
      if (appShell) {
        appShell.classList.add('admin-mode')
      }
      if (adminSidebarGlobal) {
        adminSidebarGlobal.style.display = "block"
      }
    } else {
      // Show normal sidebar and hide admin sidebar for non-admin users
      if (appShell) {
        appShell.classList.remove('admin-mode')
      }
      if (adminSidebarGlobal) {
        adminSidebarGlobal.style.display = "none"
      }
    }
  } else {
    loginBtn.style.display = "inline-block"
    logoutBtn.style.display = "none"
    bookingsNav.style.display = "inline-block"
    adminNav.style.display = "none"
    // Show normal sidebar and hide admin sidebar when logged out
    if (appShell) {
      appShell.classList.remove('admin-mode')
    }
    if (adminSidebarGlobal) {
      adminSidebarGlobal.style.display = "none"
    }
  }

  // refresh badge
  app.updateBookingsBadge?.()
}

function connectWebSocket() {
  // Real-time seat updates
  console.log("WebSocket connection initialized")
}

// Seed data on first load
window.addEventListener("load", async () => {
  try {
    await fetch(`${API_URL}/seed`)
  } catch (err) {
    console.log("Data already seeded")
  }
})




async function showEventDetails(event) {
    currentEvent = event;
    
    // Hide events list and show details
    document.getElementById('eventsList').style.display = 'none';
    const detailsSection = document.getElementById('eventDetails');
    detailsSection.style.display = 'block';
    
    // Update event info
    detailsSection.innerHTML = `
        <div class="event-header">
            <button onclick="backToEvents()" class="btn btn-secondary">&larr; Back</button>
            <h2>${event.title}</h2>
        </div>
        
        <div class="event-info">
            <img src="${event.image}" alt="${event.title}" class="event-image">
            <div class="event-details">
                <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
                <p><strong>Time:</strong> ${event.time}</p>
                <p><strong>Price:</strong> ₹${event.price}</p>
            </div>
        </div>

        <!-- Seat Layout -->
        <div class="seat-layout">
            <div class="screen">SCREEN</div>
            <div class="seat-map">
                <!-- Row A -->
                <div class="seat-row">
                    <div class="row-label">A</div>
                    ${generateSeatButtons('A', 10)}
                </div>
                
                <!-- Row B -->
                <div class="seat-row">
                    <div class="row-label">B</div>
                    ${generateSeatButtons('B', 10)}
                </div>
                
                <!-- Row C -->
                <div class="seat-row">
                    <div class="row-label">C</div>
                    ${generateSeatButtons('C', 10)}
                </div>
                
                <!-- Row D -->
                <div class="seat-row">
                    <div class="row-label">D</div>
                    ${generateSeatButtons('D', 10)}
                </div>
                
                <!-- Row E -->
                <div class="seat-row">
                    <div class="row-label">E</div>
                    ${generateSeatButtons('E', 10)}
                </div>
            </div>

            <!-- Seat Info -->
            <div class="seat-info">
                <div class="seat-type">
                    <div class="indicator available"></div>
                    <span>Available</span>
                </div>
                <div class="seat-type">
                    <div class="indicator selected"></div>
                    <span>Selected</span>
                </div>
                <div class="seat-type">
                    <div class="indicator booked"></div>
                    <span>Booked</span>
                </div>
                <div class="seat-type">
                    <div class="indicator blocked"></div>
                    <span>Blocked</span>
                </div>
            </div>

            <!-- Booking Section -->
            <div class="booking-section">
                <div class="booking-info">
                    <p>Selected: <span id="seatCount">0</span> seats</p>
                    <button id="bookButton" class="btn btn-primary" disabled onclick="proceedToBooking()">
                        Select Seats to Book
                    </button>
                </div>
            </div>
        </div>
    `;

    // Initialize seat selection
    initializeSeatSelection();
}

function backToEvents() {
    document.getElementById('eventsList').style.display = 'block';
    document.getElementById('eventDetails').style.display = 'none';
    currentEvent = null;
    selectedSeats = [];
}

function generateSeatButtons(row, count) {
    let buttons = '';
    for (let i = 1; i <= count; i++) {
        // Add some random blocked seats for demo
        const isBlocked = (row === 'A' && (i === 9 || i === 10)) || 
                         (row === 'C' && (i === 3 || i === 4));
        const className = `seat ${isBlocked ? 'blocked' : ''}`;
        
        buttons += `
            <button class="${className}" 
                    data-row="${row}" 
                    data-seat="${i}"
                    ${isBlocked ? 'disabled' : ''}>
                ${i}
            </button>
        `;
    }
    return buttons;
}

async function proceedToBooking() {
    if (!currentUser) {
        alert('Please login to book tickets');
        app.showPage('login');
        return;
    }

    if (selectedSeats.length === 0) {
        alert('Please select seats to book');
        return;
    }

    const totalAmount = selectedSeats.length * currentEvent.price;
    
    try {
        // Create booking
        const response = await fetch(`${API_URL}/bookings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                eventId: currentEvent._id,
                seats: selectedSeats.map(seatId => {
                    const [row, number] = seatId.split('');
                    return { row, seatNumber: parseInt(number) };
                }),
                totalAmount
            })
        });

        const booking = await response.json();
        
        if (booking.error) {
            throw new Error(booking.error);
        }

        // Clear selection and show success
        clearSeatSelection();
        alert('Booking successful! Check your bookings page for details.');
        app.showPage('bookings');

    } catch (error) {
        alert('Failed to create booking: ' + error.message);
    }
}



// Seat Selection Logic
let selectedSeats = [];
const maxSelectableSeats = 6;  // Maximum seats that can be selected at once

function initializeSeatSelection() {
    // Add click handlers to all seats
    document.querySelectorAll('.seat').forEach(seat => {
        if (!seat.classList.contains('booked') && !seat.classList.contains('blocked')) {
            seat.addEventListener('click', handleSeatClick);
        }
    });
}

function handleSeatClick(event) {
    const seat = event.target;
    const row = seat.dataset.row;
    const seatNum = seat.dataset.seat;
    const seatId = `${row}${seatNum}`;

    // If seat is already selected, unselect it
    if (seat.classList.contains('selected')) {
        seat.classList.remove('selected');
        selectedSeats = selectedSeats.filter(s => s !== seatId);
        updateBookingButton();
        return;
    }

    // Check if maximum seats are already selected
    if (selectedSeats.length >= maxSelectableSeats) {
        alert(`You can only select up to ${maxSelectableSeats} seats at a time.`);
        return;
    }

    // Select the seat
    seat.classList.add('selected');
    selectedSeats.push(seatId);
    updateBookingButton();
}

function updateBookingButton() {
    const bookButton = document.getElementById('bookButton');
    if (!bookButton) return;

    if (selectedSeats.length > 0) {
        bookButton.removeAttribute('disabled');
        bookButton.textContent = `Book ${selectedSeats.length} Seat${selectedSeats.length > 1 ? 's' : ''}`;
    } else {
        bookButton.setAttribute('disabled', 'disabled');
        bookButton.textContent = 'Select Seats to Book';
    }
}

function clearSeatSelection() {
    document.querySelectorAll('.seat.selected').forEach(seat => {
        seat.classList.remove('selected');
    });
    selectedSeats = [];
    updateBookingButton();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeSeatSelection();
    
    // Add book button if it doesn't exist
    if (!document.getElementById('bookButton')) {
        const bookingSection = document.createElement('div');
        bookingSection.className = 'booking-section';
        bookingSection.innerHTML = `
            <div class="booking-info">
                <p>Selected: <span id="seatCount">0</span> seats</p>
                <button id="bookButton" class="btn btn-primary" disabled>
                    Select Seats to Book
                </button>
            </div>
        `;
        document.querySelector('.seat-layout').appendChild(bookingSection);
    }
});
