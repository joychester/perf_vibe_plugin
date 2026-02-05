# perf-vibe

A Chrome browser extension that tracks and displays page performance metrics with visual change tracking in real-time.

![perf-vibe Screenshot](Screenshot.png)

## Features

### Performance Metrics
Track all critical Web Vitals and performance metrics:
- **TTFB** - Time to First Byte
- **FCP** - First Contentful Paint
- **LCP** - Largest Contentful Paint (with candidate history)
- **TTI** - Time to Interactive
- **TBT** - Total Blocking Time
- **CLS** - Cumulative Layout Shift
- **DOM Ready** - DOMContentLoaded event
- **Load Complete** - Window load event
- **First Paint** - First paint timing
- **Last Pixel Change** - When page stops visually changing

### Visual Timeline
- Interactive timeline chart showing all metrics
- Color-coded bars (green/yellow/red) based on performance thresholds
- Zoom and pan support (drag to zoom, scroll to pan, double-click to reset)
- Visual change markers with count badges

### Visual Changes Tracking
- Real-time tracking of DOM mutations
- History list showing all visual changes with timestamps
- Stability indicator showing when page stops changing
- Eye icon markers indicating visual stability points (no changes for 500ms+)
- LPC (Last Pixel Change) badge on the final visual change

### LCP Candidates
- Track all LCP candidate elements
- View element details (tag, selector, size, URL)
- Click to highlight element on page

### Soft Navigation Support
- Automatic detection of SPA navigations (pushState, replaceState, popstate)
- Separate metrics for page load vs navigation
- Switch between Page Load and Navigation modes

### User Interface
- **Draggable widget** - Position anywhere on screen
- **Semi-transparent** - Doesn't block page content
- **Dark mode** - Toggle between light and dark themes
- **Collapsible sections** - Minimize timeline, LCP history, or visual changes
- **Responsive design** - Adapts to smaller screens

### Recording Controls
- **Start/Stop recording** - Pause metric collection on demand
- **Domain ignore list** - Block tracking on specific domains
- **Quick add domain** - One-click add current domain to ignore list
- **Close widget** - Hide widget for current tab session (survives reloads)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `perf_vibe_plugin` folder

## Usage

Once installed, the widget automatically appears on every page.

### Header Controls (left to right)
| Icon | Function |
|------|----------|
| `⏺` | Start/Stop recording (red = recording, white = stopped) |
| `⇆` | Switch between Page Load and Navigation modes |
| `🌙/☀️` | Toggle dark/light mode |
| `⚙` | Open settings |
| `−/+` | Collapse/expand widget content |
| `✕` | Close widget for this tab |

### Settings
Click the gear icon to access settings:
- **Quick Add Domain**: Shows current domain with one-click add button
- **Domain Ignore List**: Enter domains (one per line) to block tracking
- Changes require page reload to take effect

### Timeline Interactions
- **Drag** to select and zoom into a time range
- **Scroll** horizontally to pan when zoomed
- **Double-click** to reset zoom
- **Hover** over bars to see metric details

### Visual Changes List
- Click any item to highlight the element on the page
- Items with 👁 icon indicate stability points
- Items with LPC badge mark the last visual change

## Files

```
perf_vibe_plugin/
├── manifest.json    # Chrome extension manifest (V3)
├── content.js       # Main plugin logic
├── styles.css       # Widget styling
└── README.md        # This file
```

## Performance Thresholds

Metrics are color-coded based on Google's Web Vitals thresholds:

| Metric | Good (Green) | Needs Improvement (Yellow) | Poor (Red) |
|--------|--------------|---------------------------|------------|
| TTFB | ≤800ms | ≤1800ms | >1800ms |
| FCP | ≤1800ms | ≤3000ms | >3000ms |
| LCP | ≤2500ms | ≤4000ms | >4000ms |
| TTI | ≤3800ms | ≤7300ms | >7300ms |
| TBT | ≤200ms | ≤600ms | >600ms |
| CLS | ≤0.1 | ≤0.25 | >0.25 |

## Browser Support

- Chrome 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)

## Privacy

- All data is stored locally in the browser
- No external requests or data collection
- Domain ignore list stored in localStorage
- Tab session state stored in sessionStorage

## License

MIT License - Feel free to use and modify as needed.
