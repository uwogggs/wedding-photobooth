# 💒 Wedding Photobooth

A self-hosted, no-print photo booth for weddings. Guests scan a QR code with their phone, take selfies with optional wedding-themed frames, and photos auto-upload to a shared gallery. A live slideshow can be displayed on a TV/projector at the venue in real-time.

## How It Works

```
Guest scans QR  →  Opens photobooth in browser  →  Takes photo with frame
      ↓                                                    ↓
  No app install                                    Auto-uploads to server
      ↓                                                    ↓
  Phone camera                                      Appears on venue TV slideshow
                                                           ↓
                                              After wedding: share gallery link
```
netsh advfirewall firewall add rule name="Wedding Photobooth HTTP" dir=in action=allow protocol=TCP localport=3006

netsh advfirewall firewall add rule name="Wedding Photobooth HTTPS" dir=in action=allow protocol=TCP localport=3007
## Pages

| Page | URL | Purpose |
|------|-----|---------|
| **Photobooth** | `/` | What guests see — camera, countdown, frames, upload |
| **Slideshow** | `/slideshow.html` | Auto-rotating gallery for venue TV/projector |
| **Gallery** | `/gallery.html` | Browse, download, and share all photos |
| **Setup** | `/setup.html` | QR code poster — print and display at the venue |

## Quick Start

```bash
# 1. Install dependencies
cd wedding-photobooth
npm install

# 2. Customize (edit server.js)
#    Change COUPLE_NAMES, WEDDING_DATE, WEDDING_HASHTAG

# 3. Start
npm start

# 4. Open the setup page to get your QR code
#    http://localhost:3000/setup.html
```

## Customization

Edit the top of `server.js`:

```javascript
const COUPLE_NAMES = 'Jonathan & Partner';      // Displayed on all pages
const WEDDING_DATE = '2026';                    // Shown on header
const WEDDING_HASHTAG = '#JonathanWedding2026'; // Shown on header
const PORT = 3000;                              // Change if needed
```

## Deployment Options

### Option 1: Laptop at the Venue (Simplest)

Run the server on a laptop connected to the venue WiFi.

```bash
npm start
```

- **Photobooth:** Guests scan QR code → opens on their phone via WiFi
- **Slideshow:** Connect laptop to TV/projector → open `/slideshow.html` fullscreen
- **No internet required** — everything runs on the local network

To find your laptop's IP address (for the QR code):

```bash
# Windows (PowerShell)
ipconfig | findstr "IPv4"

# macOS / Linux
ifconfig | grep "inet "
```

The server prints all URLs on startup. The QR code points to your local IP.

### Option 2: Cloud Deployment (Persistent Gallery)

Deploy to a free hosting platform so the gallery stays online after the wedding.

#### Vercel (Recommended — Free)

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Add a `vercel.json`:
   ```json
   {
     "version": 2,
     "builds": [{ "src": "server.js", "use": "@vercel/node" }],
     "routes": [{ "src": "/(.*)", "dest": "/server.js" }]
   }
   ```

3. Deploy:
   ```bash
   vercel --prod
   ```

4. Note: Vercel's serverless functions don't persist files to disk. For cloud storage, see the **Cloud Storage** section below.

#### Railway (Free Tier — Persistent Disk)

1. Push the project to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js and runs `npm start`
4. Add a persistent volume mounted to `/app/photos` in the Railway dashboard

#### Render (Free Tier)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Build command: `npm install`
4. Start command: `node server.js`
5. Note: Free tier spins down after inactivity — first load may be slow

#### Your Own VPS

```bash
# SSH into your server
ssh user@your-server.com

# Clone/upload the project
scp -r wedding-photobooth/ user@your-server.com:~/

# Install and run
cd ~/wedding-photobooth
npm install

# Run with pm2 (keeps it alive)
npm i -g pm2
pm2 start server.js --name wedding-photobooth
pm2 save
pm2 startup
```

### Option 3: Hybrid (Local + Cloud Sync)

Run locally at the venue for reliability, then sync photos to the cloud after.

**During the wedding:**
```bash
# Run locally — works without internet
npm start
```

**After the wedding — sync to Google Drive:**

```bash
# Install rclone (https://rclone.org)
# Configure Google Drive
rclone config

# Sync photos
rclone sync ./photos gdrive:WeddingPhotos/ --progress
```

**Or sync to any cloud storage:**
```bash
# AWS S3
aws s3 sync ./photos s3://your-bucket/wedding-photos/

# Dropbox (via rclone)
rclone sync ./photos dropbox:WeddingPhotos/
```

## Network Setup at the Venue

### Option A: Venue WiFi

Most venues have WiFi. Just connect the laptop running the server to it.
Guests connect to the same WiFi → scan QR → done.

### Option B: Portable Hotspot

If the venue has no WiFi, use a phone hotspot:

1. Enable hotspot on your phone
2. Connect the laptop to the hotspot
3. Guests connect to the same hotspot
4. Works completely offline — no internet needed

### Option C: Dedicated Router

For larger weddings (100+ guests), a dedicated WiFi router is recommended:

1. Buy a portable router (e.g., TP-Link TL-WR902AC, ~$30)
2. Plug it in at the venue
3. Connect the laptop to it
4. No internet needed — it just creates a local network

## Features

### Photobooth (Guest Page)

- **3-2-1 countdown** — dramatic countdown before each shot
- **Flash effect** — simulates camera flash
- **4 wedding frames** — Gold ✨, Floral 🌸, Hearts 💕, Classic 🖼️
- **Front/back camera** — switch between selfie and rear camera
- **Guest name** — optional name field (shown in gallery)
- **Preview & retake** — review before uploading
- **Mobile-first** — optimized for phone cameras

### Slideshow (Venue TV)

- **Auto-rotates** — new photo every 6 seconds
- **Auto-refreshes** — polls for new photos every 5 seconds
- **Guest names** — shows who took each photo
- **QR code corner** — guests can scan from their seats
- **Fullscreen** — click the header to go fullscreen
- **Dark theme** — looks great on projectors

### Gallery (Post-Wedding)

- **Grid view** — responsive photo grid
- **Lightbox** — tap to view full-size, swipe to navigate
- **Download individual** — download any single photo
- **Download all** — bulk download every photo
- **Share** — native share button (on mobile) or copy link
- **Auto-refresh** — picks up new photos every 10 seconds

### Setup Page (Organizer)

- **QR code** — auto-generated from your server's IP address
- **Print-ready** — click "Print" to get a poster
- **Step-by-step instructions** — shown on the printed poster

## File Structure

```
wedding-photobooth/
├── server.js           # Backend server (Express + Multer)
├── package.json        # Dependencies
├── photos/             # Uploaded photos are saved here
│   ├── guest_1234567890.jpg
│   └── ...
└── public/             # Frontend pages
    ├── index.html      # Photobooth (guest-facing)
    ├── slideshow.html  # Live slideshow (venue TV)
    ├── gallery.html    # Photo gallery (post-wedding)
    └── setup.html      # QR code setup (print this)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload a photo (multipart form, field: `photo`) |
| `GET` | `/api/photos` | List all photos (JSON) |
| `GET` | `/api/config` | Wedding config (couple name, date, hashtag) |
| `GET` | `/api/qrcode` | Generate QR code as data URL |
| `GET` | `/photos/:filename` | Serve a photo file |

## Troubleshooting

### Guests can't connect

1. **Check WiFi** — laptop and guests must be on the same network
2. **Check firewall** — Windows Firewall may block port 3000
   ```bash
   # Windows: allow Node.js through firewall
   netsh advfirewall firewall add rule name="Wedding Photobooth" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes
   ```
3. **Check IP** — make sure the QR code points to your local IP, not `localhost`

### Photos not uploading

1. **Check file size** — max 15MB per photo (configurable in `server.js`)
2. **Check storage** — make sure the `photos/` folder is writable
3. **Check browser** — some older browsers don't support the camera API

### Slideshow not updating

1. The slideshow polls every 5 seconds — wait a moment after upload
2. Refresh the page if photos don't appear
3. Check the browser console for errors

### Camera not working on iOS

- iOS Safari requires HTTPS for camera access on non-localhost URLs
- Solution: use `localhost` on the device running the server, or deploy with HTTPS
- Workaround: use the laptop's camera (rear camera button) at the venue kiosk

## License

Free to use. Made with 💕 for weddings.
