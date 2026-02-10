// Create performance tracker widget with soft navigation support
(function() {
  'use strict';

  // Check if widget was closed for this tab session
  if (sessionStorage.getItem('perf-vibe-closed') === 'true') {
    return; // Don't show widget if user closed it in this tab
  }

  // State management
  let currentMode = 'page-load'; // 'page-load' or 'navigation'
  let isDarkMode = false; // Theme state
  let isRecording = true; // Recording state - starts recording automatically
  let isDomainIgnored = false; // Domain ignore state
  let navigationCount = 0;
  let navigationStartTime = null;
  let isTrackingNavigation = false;

  // Check if current domain is in the ignore list
  function checkDomainIgnored() {
    const savedDomains = localStorage.getItem('perf-vibe-ignored-domains');
    if (!savedDomains) return false;

    const currentDomain = window.location.hostname.toLowerCase();
    const ignoredDomains = savedDomains.split('\n').map(d => d.trim().toLowerCase()).filter(d => d);

    return ignoredDomains.some(d => {
      // Match exact domain or subdomain
      return currentDomain === d || currentDomain.endsWith('.' + d) || d.endsWith('.' + currentDomain);
    });
  }

  // Initialize domain ignore state
  isDomainIgnored = checkDomainIgnored();
  
  // Metrics storage
  let pageLoadMetrics = {
    'ttfb': null,
    'dom-ready': null,
    'load-complete': null,
    'first-paint': null,
    'fcp': null,
    'lcp': null,
    'tti': null,
    'tbt': null,
    'cls': null,
    'inp': null,
    'dom-size': null,
    'last-pixel-change': null
  };
  let navigationMetrics = {
    'ttfb': null,
    'dom-ready': null,
    'load-complete': null,
    'first-paint': null,
    'fcp': null,
    'lcp': null,
    'tti': null,
    'tbt': null,
    'cls': null,
    'inp': null,
    'dom-size': null,
    'last-pixel-change': null
  };
  
  // Performance observers
  let fcpObserver = null;
  let lcpObserver = null;
  let clsObserver = null;
  let longTaskObserver = null;
  let inpObserver = null;
  let customMetricObserver = null;
  let clsValue = 0;
  let longTasks = [];
  let worstInp = 0; // Track worst interaction duration for INP

  // Custom metrics tracking
  let customMetricNames = []; // List of custom metric names to track
  let customMarks = []; // Array of { name, timestamp }
  let customMeasures = []; // Array of { name, startTime, duration }

  // Load custom metric names from localStorage
  function loadCustomMetricNames() {
    const saved = localStorage.getItem('perf-vibe-custom-metrics');
    if (saved) {
      customMetricNames = saved.split('\n').map(n => n.trim()).filter(n => n);
    }
    return customMetricNames;
  }
  loadCustomMetricNames();

  // Timeline zoom and pan state
  let timelineZoom = {
    level: 1,           // 1 = no zoom, higher = zoomed in
    panOffset: 0,       // horizontal pan offset in pixels
    isDragging: false,
    isSelecting: false,
    dragStartX: 0,
    selectionStart: 0,
    selectionEnd: 0
  };

  // Maximum tracking duration (8 seconds) - ignore metrics above this
  const MAX_METRIC_DURATION = 8000;

  // Change history tracking
  const changeHistory = [];
  const MAX_HISTORY_ITEMS = 50;
  const STABLE_STATE_THRESHOLD = 500; // ms without changes to be considered stable
  let lastChangeTimestamp = 0;
  let stableStateTimer = null;
  let highlightedElement = null;
  let highlightOverlay = null;

  // LCP candidates history tracking
  const lcpCandidates = [];
  let lcpHighlightOverlay = null;

  // Heatmap state
  let heatmapOverlay = null;
  let isHeatmapVisible = false;

  // Performance thresholds for color coding (in ms)
  // Based on Web Vitals recommendations
  const performanceThresholds = {
    'ttfb': { good: 800, needsImprovement: 1800 },
    'fcp': { good: 1800, needsImprovement: 3000 },
    'lcp': { good: 2500, needsImprovement: 4000 },
    'tti': { good: 3800, needsImprovement: 7300 },
    'tbt': { good: 200, needsImprovement: 600 },
    'cls': { good: 0.1, needsImprovement: 0.25 },
    'inp': { good: 200, needsImprovement: 500 },
    'dom-size': { good: 2500, needsImprovement: 4000 },
    'dom-ready': { good: 1500, needsImprovement: 3000 },
    'load-complete': { good: 3000, needsImprovement: 6000 },
    'first-paint': { good: 1000, needsImprovement: 2500 },
    'last-pixel-change': { good: 3500, needsImprovement: 6000 }
  };

  // Get performance rating color
  function getPerformanceColor(metricKey, value) {
    const thresholds = performanceThresholds[metricKey];
    if (!thresholds) return '#6b7280'; // gray for unknown

    if (value <= thresholds.good) {
      return '#10b981'; // green - good
    } else if (value <= thresholds.needsImprovement) {
      return '#f59e0b'; // yellow/orange - needs improvement
    } else {
      return '#ef4444'; // red - poor
    }
  }

  // Get performance rating label
  function getPerformanceRating(metricKey, value) {
    const thresholds = performanceThresholds[metricKey];
    if (!thresholds) return '';

    if (value <= thresholds.good) {
      return 'good';
    } else if (value <= thresholds.needsImprovement) {
      return 'needs-improvement';
    } else {
      return 'poor';
    }
  }

  // Create the widget container
  const widget = document.createElement('div');
  widget.id = 'performance-tracker-widget';
  widget.innerHTML = `
    <div class="widget-header">
      <div class="header-left">
        <span class="widget-title"><span class="drag-hint">⋮⋮</span> ⚡ perf-vibe</span>
        <div class="mode-indicator" id="mode-indicator">
          <span class="mode-badge" id="mode-badge">Page Load</span>
          <span class="nav-count" id="nav-count"></span>
        </div>
      </div>
      <div class="header-right">
        <button id="record-toggle" class="record-toggle-btn recording" title="Stop recording">⏺</button>
        <button id="mode-toggle" class="mode-toggle-btn" title="Switch between Page Load and Navigation metrics">⇆</button>
        <button id="theme-toggle" class="theme-toggle-btn" title="Toggle dark/light mode">🌙</button>
        <button id="settings-toggle" class="settings-toggle-btn" title="Settings">⚙</button>
        <button id="toggle-widget" class="toggle-btn">−</button>
        <button id="close-widget" class="close-widget-btn" title="Close widget">✕</button>
      </div>
    </div>
    <div class="widget-content" id="widget-content">
      <div class="timeline-section">
        <div class="timeline-header">
          <span class="timeline-title">Loading Timeline</span>
          <div class="timeline-controls">
            <span class="zoom-level" id="zoom-level">1x</span>
            <button id="zoom-reset" class="zoom-btn" title="Reset zoom">⟲</button>
            <button id="toggle-timeline" class="toggle-timeline-btn" title="Toggle timeline">▼</button>
          </div>
        </div>
        <div class="timeline-container" id="timeline-container">
          <div class="timeline-chart" id="timeline-chart">
            <div class="timeline-selection" id="timeline-selection"></div>
          </div>
          <div class="timeline-hint" id="timeline-hint">Drag to zoom • Scroll to pan • Double-click to reset</div>
        </div>
      </div>
      <div class="metrics-section">
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="ttfb"></span>Time to First Byte:</span>
          <span class="metric-value" id="ttfb">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="first-paint"></span>First Paint:</span>
          <span class="metric-value" id="first-paint">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="fcp"></span>First Contentful Paint:</span>
          <span class="metric-value" id="fcp">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="dom-ready"></span>DOM Ready:</span>
          <span class="metric-value" id="dom-ready">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="lcp"></span>Largest Contentful Paint:</span>
          <span class="metric-value" id="lcp">-</span>
        </div>
        <div class="lcp-history-section">
          <div class="lcp-history-header">
            <span class="lcp-history-title">LCP Candidates</span>
            <div class="lcp-history-controls">
              <span class="lcp-count" id="lcp-count">0</span>
              <button id="toggle-lcp-history" class="toggle-lcp-btn" title="Toggle LCP history">▼</button>
            </div>
          </div>
          <div class="lcp-history-container" id="lcp-history-container">
            <div class="lcp-history-list" id="lcp-history-list">
              <div class="lcp-history-empty">No LCP candidates detected yet</div>
            </div>
          </div>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="load-complete"></span>Load Complete:</span>
          <span class="metric-value" id="load-complete">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="tti"></span>Time to Interactive:</span>
          <span class="metric-value" id="tti">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="tbt"></span>Total Blocking Time:</span>
          <span class="metric-value" id="tbt">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="cls"></span>Cumulative Layout Shift:</span>
          <span class="metric-value" id="cls">-</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="inp"></span>Interaction to Next Paint:</span>
          <span class="metric-value" id="inp">waiting...</span>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="dom-size"></span>DOM Elements:</span>
          <span class="metric-value" id="dom-size">-</span>
          <button id="heatmap-toggle" class="heatmap-toggle-btn" title="Show content density heatmap">▧</button>
        </div>
        <div class="metric">
          <span class="metric-label"><span class="metric-color-indicator" data-metric="last-pixel-change"></span>Last Pixel Change:</span>
          <span class="metric-value" id="last-pixel-change">-</span>
        </div>
      </div>
      <div class="change-history-section">
        <div class="change-history-header">
          <span class="change-history-title">Visual Changes</span>
          <div class="change-history-controls">
            <span class="stable-indicator" id="stable-indicator" title="Page stability status"></span>
            <button id="toggle-history" class="toggle-history-btn" title="Toggle history">▼</button>
          </div>
        </div>
        <div class="change-history-container" id="change-history-container">
          <div class="change-history-list" id="change-history-list">
            <div class="change-history-empty">No visual changes detected yet</div>
          </div>
        </div>
      </div>
      <div class="resources-section">
        <div class="resources-header">
          <span class="resources-title">📊 Resource Monitoring</span>
          <div class="resources-controls">
            <span class="resources-count" id="resources-count">0</span>
            <button id="toggle-resources" class="toggle-resources-btn" title="Toggle resources">▼</button>
          </div>
        </div>
        <div class="resources-container" id="resources-container">
          <div class="resources-summary" id="resources-summary">
            <div class="resources-loading">Loading resources...</div>
          </div>
          <button id="view-waterfall" class="view-waterfall-btn" disabled><span class="collecting-spinner"></span>Collecting...</button>
        </div>
      </div>
    </div>
    <div class="settings-overlay" id="settings-overlay" style="display: none;">
      <div class="settings-panel">
        <div class="settings-header">
          <span class="settings-title">⚙ Settings</span>
          <button id="close-settings" class="close-settings-btn" title="Close settings">✕</button>
        </div>
        <div class="settings-content">
          <div class="settings-section">
            <label class="settings-label">Quick Add Current Domain</label>
            <div class="quick-add-domain">
              <span class="current-domain" id="current-domain"></span>
              <button id="add-current-domain" class="add-domain-btn" title="Add to ignore list">+ Add</button>
            </div>
          </div>
          <div class="settings-section">
            <label class="settings-label">Domain Ignore List</label>
            <p class="settings-hint">Enter domains to ignore (one per line). The plugin will not track metrics on these domains.</p>
            <textarea id="domain-ignore-list" class="domain-ignore-textarea" placeholder="example.com&#10;subdomain.example.org"></textarea>
          </div>
          <div class="settings-section">
            <label class="settings-label">Custom Metrics</label>
            <p class="settings-hint">Enter performance.mark() or performance.measure() names to track (one per line). Matching metrics will appear on the timeline.</p>
            <textarea id="custom-metrics-list" class="custom-metrics-textarea" placeholder="my-app-ready&#10;api-response-time&#10;component-render"></textarea>
          </div>
          <div class="settings-actions">
            <button id="save-settings" class="settings-save-btn">Save</button>
          </div>
          <div class="settings-status" id="settings-status"></div>
        </div>
      </div>
    </div>
  `;

  // Append to body when DOM is ready
  function injectWidget() {
    if (document.body) {
      document.body.appendChild(widget);
      setupEventListeners();
      // Show domain ignored banner if applicable
      if (isDomainIgnored) {
        showDomainIgnoredBanner();
      }
    } else {
      setTimeout(injectWidget, 10);
    }
  }

  // Show banner when domain is ignored
  function showDomainIgnoredBanner() {
    const widgetContent = document.getElementById('widget-content');
    if (!widgetContent) return;

    const banner = document.createElement('div');
    banner.className = 'domain-ignored-banner';
    banner.innerHTML = `
      <span class="banner-icon">🚫</span>
      <span class="banner-text">Recording blocked for <span class="banner-domain">${window.location.hostname}</span></span>
    `;
    widgetContent.insertBefore(banner, widgetContent.firstChild);

    // Update recording button to show stopped state
    const recordToggle = document.getElementById('record-toggle');
    if (recordToggle) {
      recordToggle.classList.remove('recording');
      recordToggle.classList.add('stopped');
      recordToggle.textContent = '▶';
      recordToggle.title = 'Domain is in ignore list';
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    const toggleBtn = document.getElementById('toggle-widget');
    const widgetContent = document.getElementById('widget-content');
    const modeToggle = document.getElementById('mode-toggle');
    const toggleTimeline = document.getElementById('toggle-timeline');
    const timelineContainer = document.getElementById('timeline-container');
    let isCollapsed = false;
    let isTimelineCollapsed = false;

    toggleBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      widgetContent.style.display = isCollapsed ? 'none' : 'block';
      toggleBtn.textContent = isCollapsed ? '+' : '−';
    });

    // Close widget button
    const closeWidgetBtn = document.getElementById('close-widget');
    if (closeWidgetBtn) {
      closeWidgetBtn.addEventListener('click', () => {
        // Stop recording
        isRecording = false;
        // Remember that user closed widget for this tab session
        sessionStorage.setItem('perf-vibe-closed', 'true');
        // Remove the widget from DOM
        widget.remove();
        // Also remove heatmap if visible
        if (heatmapOverlay) {
          heatmapOverlay.remove();
          heatmapOverlay = null;
          isHeatmapVisible = false;
        }
      });
    }

    // Heatmap toggle button
    const heatmapToggleBtn = document.getElementById('heatmap-toggle');
    if (heatmapToggleBtn) {
      heatmapToggleBtn.addEventListener('click', toggleHeatmap);
    }

    // Theme toggle (dark/light mode)
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      // Load saved theme preference
      const savedTheme = localStorage.getItem('perf-vibe-theme');
      if (savedTheme === 'dark') {
        isDarkMode = true;
        widget.classList.add('dark-mode');
        themeToggle.textContent = '☀️';
        themeToggle.title = 'Switch to light mode';
      }

      themeToggle.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        if (isDarkMode) {
          widget.classList.add('dark-mode');
          themeToggle.textContent = '☀️';
          themeToggle.title = 'Switch to light mode';
          localStorage.setItem('perf-vibe-theme', 'dark');
        } else {
          widget.classList.remove('dark-mode');
          themeToggle.textContent = '🌙';
          themeToggle.title = 'Switch to dark mode';
          localStorage.setItem('perf-vibe-theme', 'light');
        }
      });
    }

    // Recording toggle (start/stop tracking)
    const recordToggle = document.getElementById('record-toggle');
    if (recordToggle) {
      recordToggle.addEventListener('click', () => {
        isRecording = !isRecording;
        if (isRecording) {
          recordToggle.classList.add('recording');
          recordToggle.classList.remove('stopped');
          recordToggle.textContent = '⏺';
          recordToggle.title = 'Stop recording';
          // Resume tracking
          resumeTracking();
        } else {
          recordToggle.classList.remove('recording');
          recordToggle.classList.add('stopped');
          recordToggle.textContent = '▶';
          recordToggle.title = 'Start recording';
          // Pause tracking
          pauseTracking();
        }
      });
    }

    // Settings overlay toggle
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsOverlay = document.getElementById('settings-overlay');
    const closeSettings = document.getElementById('close-settings');
    const domainIgnoreList = document.getElementById('domain-ignore-list');
    const customMetricsList = document.getElementById('custom-metrics-list');
    const saveSettings = document.getElementById('save-settings');
    const settingsStatus = document.getElementById('settings-status');
    const currentDomainEl = document.getElementById('current-domain');
    const addCurrentDomainBtn = document.getElementById('add-current-domain');
    let isSettingsOpen = false;

    // Show current domain
    const currentHostname = window.location.hostname;
    if (currentDomainEl) {
      currentDomainEl.textContent = currentHostname;
    }

    const openSettingsPanel = () => {
      isSettingsOpen = true;
      settingsOverlay.style.display = 'flex';
      settingsToggle.classList.add('active');
      // Update add button state
      updateAddButtonState();
    };

    const closeSettingsPanel = () => {
      isSettingsOpen = false;
      settingsOverlay.style.display = 'none';
      settingsToggle.classList.remove('active');
    };

    const updateAddButtonState = () => {
      if (!addCurrentDomainBtn || !domainIgnoreList) return;
      const domains = domainIgnoreList.value.split('\n').map(d => d.trim().toLowerCase()).filter(d => d);
      const isAlreadyAdded = domains.includes(currentHostname.toLowerCase());
      if (isAlreadyAdded) {
        addCurrentDomainBtn.textContent = '✓ Added';
        addCurrentDomainBtn.classList.add('added');
        addCurrentDomainBtn.disabled = true;
      } else {
        addCurrentDomainBtn.textContent = '+ Add';
        addCurrentDomainBtn.classList.remove('added');
        addCurrentDomainBtn.disabled = false;
      }
    };

    if (settingsToggle && settingsOverlay) {
      // Load saved domain ignore list
      const savedDomains = localStorage.getItem('perf-vibe-ignored-domains');
      if (savedDomains && domainIgnoreList) {
        domainIgnoreList.value = savedDomains;
      }

      // Load saved custom metrics list
      const savedCustomMetrics = localStorage.getItem('perf-vibe-custom-metrics');
      if (savedCustomMetrics && customMetricsList) {
        customMetricsList.value = savedCustomMetrics;
      }

      // Quick add current domain button
      if (addCurrentDomainBtn && domainIgnoreList) {
        addCurrentDomainBtn.addEventListener('click', () => {
          const currentValue = domainIgnoreList.value.trim();
          const domains = currentValue.split('\n').map(d => d.trim().toLowerCase()).filter(d => d);

          // Check if already in list
          if (!domains.includes(currentHostname.toLowerCase())) {
            // Add to textarea
            if (currentValue) {
              domainIgnoreList.value = currentValue + '\n' + currentHostname;
            } else {
              domainIgnoreList.value = currentHostname;
            }
            // Update button state
            updateAddButtonState();
            // Show hint
            settingsStatus.textContent = 'Domain added! Click Save to apply.';
            settingsStatus.className = 'settings-status info';
            setTimeout(() => {
              settingsStatus.className = 'settings-status';
            }, 3000);
          }
        });

        // Update button state when textarea changes
        domainIgnoreList.addEventListener('input', updateAddButtonState);
      }

      settingsToggle.addEventListener('click', () => {
        if (isSettingsOpen) {
          closeSettingsPanel();
        } else {
          openSettingsPanel();
        }
      });

      // Close button
      if (closeSettings) {
        closeSettings.addEventListener('click', closeSettingsPanel);
      }

      // Close on overlay background click
      settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
          closeSettingsPanel();
        }
      });

      if (saveSettings) {
        saveSettings.addEventListener('click', () => {
          const domains = domainIgnoreList.value.trim();
          localStorage.setItem('perf-vibe-ignored-domains', domains);

          // Save custom metrics list
          const customMetrics = customMetricsList ? customMetricsList.value.trim() : '';
          localStorage.setItem('perf-vibe-custom-metrics', customMetrics);

          // Reload custom metric names and reinitialize observer
          loadCustomMetricNames();
          initCustomMetricObserver();

          // Close settings panel
          closeSettingsPanel();
        });
      }
    }

    modeToggle.addEventListener('click', () => {
      currentMode = currentMode === 'page-load' ? 'navigation' : 'page-load';
      updateModeDisplay();
      displayMetrics();
      // Ensure timeline container is visible and render timeline
      if (timelineContainer) {
        timelineContainer.style.display = 'block';
        const toggleBtn = document.getElementById('toggle-timeline');
        if (toggleBtn) {
          toggleBtn.textContent = '▼';
        }
      }
      // Force timeline to render
      setTimeout(() => {
        renderTimeline();
      }, 50);
    });

    toggleTimeline.addEventListener('click', () => {
      isTimelineCollapsed = !isTimelineCollapsed;
      timelineContainer.style.display = isTimelineCollapsed ? 'none' : 'block';
      toggleTimeline.textContent = isTimelineCollapsed ? '▶' : '▼';
    });

    // Zoom reset button
    const zoomReset = document.getElementById('zoom-reset');
    if (zoomReset) {
      zoomReset.addEventListener('click', () => {
        resetTimelineZoom();
      });
    }

    // Setup timeline interaction handlers
    setupTimelineInteractions();

    // LCP history controls
    const toggleLcpHistory = document.getElementById('toggle-lcp-history');
    const lcpHistoryContainer = document.getElementById('lcp-history-container');
    let isLcpHistoryCollapsed = false;

    if (toggleLcpHistory && lcpHistoryContainer) {
      toggleLcpHistory.addEventListener('click', () => {
        isLcpHistoryCollapsed = !isLcpHistoryCollapsed;
        lcpHistoryContainer.style.display = isLcpHistoryCollapsed ? 'none' : 'block';
        toggleLcpHistory.textContent = isLcpHistoryCollapsed ? '▶' : '▼';
      });
    }

    // Change history controls
    const toggleHistory = document.getElementById('toggle-history');
    const historyContainer = document.getElementById('change-history-container');
    let isHistoryCollapsed = false;

    if (toggleHistory && historyContainer) {
      toggleHistory.addEventListener('click', () => {
        isHistoryCollapsed = !isHistoryCollapsed;
        historyContainer.style.display = isHistoryCollapsed ? 'none' : 'block';
        toggleHistory.textContent = isHistoryCollapsed ? '▶' : '▼';
      });
    }

    // Resources section controls
    const toggleResources = document.getElementById('toggle-resources');
    const resourcesContainer = document.getElementById('resources-container');
    let isResourcesCollapsed = false;

    if (toggleResources && resourcesContainer) {
      toggleResources.addEventListener('click', () => {
        isResourcesCollapsed = !isResourcesCollapsed;
        resourcesContainer.style.display = isResourcesCollapsed ? 'none' : 'block';
        toggleResources.textContent = isResourcesCollapsed ? '▶' : '▼';
      });
    }

    // View Waterfall button
    const viewWaterfallBtn = document.getElementById('view-waterfall');
    if (viewWaterfallBtn) {
      viewWaterfallBtn.addEventListener('click', showWaterfallOverlay);
    }

    // Make widget draggable
    setupDraggable();
  }

  // Setup draggable widget functionality
  function setupDraggable() {
    const widgetHeader = widget.querySelector('.widget-header');
    if (!widgetHeader) return;

    let isDragging = false;
    let startX, startY;
    let startLeft, startTop;

    widgetHeader.addEventListener('mousedown', (e) => {
      // Don't start drag if clicking on buttons
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      widget.classList.add('dragging');

      // Get current position
      const rect = widget.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // Switch to left/top positioning for dragging
      widget.style.right = 'auto';
      widget.style.left = startLeft + 'px';
      widget.style.top = startTop + 'px';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Keep widget within viewport bounds
      const maxLeft = window.innerWidth - widget.offsetWidth;
      const maxTop = window.innerHeight - widget.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      widget.style.left = newLeft + 'px';
      widget.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        widget.classList.remove('dragging');
      }
    });

    // Handle window resize to keep widget in bounds
    window.addEventListener('resize', () => {
      const rect = widget.getBoundingClientRect();
      const maxLeft = window.innerWidth - widget.offsetWidth;
      const maxTop = window.innerHeight - widget.offsetHeight;

      if (rect.left > maxLeft) {
        widget.style.left = Math.max(0, maxLeft) + 'px';
      }
      if (rect.top > maxTop) {
        widget.style.top = Math.max(0, maxTop) + 'px';
      }
    });
  }

  // Setup timeline mouse interactions for zoom and pan
  function setupTimelineInteractions() {
    const timelineChart = document.getElementById('timeline-chart');
    if (!timelineChart) return;

    let isDragging = false;
    let isPanning = false;
    let startX = 0;
    let startPanOffset = 0;

    // Get mouse position relative to chart
    function getMouseX(e) {
      const rect = timelineChart.getBoundingClientRect();
      return e.clientX - rect.left;
    }

    // Mouse down - start drag selection or pan
    timelineChart.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click

      const mouseX = getMouseX(e);
      startX = mouseX;

      if (e.shiftKey || timelineZoom.level > 1) {
        // Pan mode when shift is held or already zoomed
        isPanning = true;
        startPanOffset = timelineZoom.panOffset;
        timelineChart.style.cursor = 'grabbing';
      } else {
        // Selection mode for zoom
        isDragging = true;
        timelineZoom.selectionStart = mouseX;
        timelineZoom.selectionEnd = mouseX;

        const selection = document.getElementById('timeline-selection');
        if (selection) {
          selection.style.display = 'block';
          selection.style.left = `${mouseX}px`;
          selection.style.width = '0px';
        }
      }

      e.preventDefault();
    });

    // Mouse move - update selection or pan
    timelineChart.addEventListener('mousemove', (e) => {
      const mouseX = getMouseX(e);

      if (isDragging) {
        timelineZoom.selectionEnd = mouseX;
        const selection = document.getElementById('timeline-selection');
        if (selection) {
          const left = Math.min(timelineZoom.selectionStart, mouseX);
          const width = Math.abs(mouseX - timelineZoom.selectionStart);
          selection.style.left = `${left}px`;
          selection.style.width = `${width}px`;
        }
      } else if (isPanning) {
        const deltaX = startX - mouseX;
        const maxPan = 280 * timelineZoom.level - 280;
        timelineZoom.panOffset = Math.max(0, Math.min(startPanOffset + deltaX * timelineZoom.level, maxPan));
        renderTimeline();
      }
    });

    // Mouse up - finish drag selection or pan
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        const selection = document.getElementById('timeline-selection');
        if (selection) {
          selection.style.display = 'none';
        }

        // Zoom to selection if large enough
        const selectionWidth = Math.abs(timelineZoom.selectionEnd - timelineZoom.selectionStart);
        if (selectionWidth > 10) {
          zoomToSelection(timelineZoom.selectionStart, timelineZoom.selectionEnd, 280);
        }
      }

      if (isPanning) {
        isPanning = false;
        timelineChart.style.cursor = 'crosshair';
      }
    };

    timelineChart.addEventListener('mouseup', handleMouseUp);
    timelineChart.addEventListener('mouseleave', handleMouseUp);

    // Double click to reset zoom
    timelineChart.addEventListener('dblclick', () => {
      resetTimelineZoom();
    });

    // Mouse wheel for pan (when zoomed) or zoom
    timelineChart.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Zoom with ctrl/cmd + scroll
        const zoomDelta = e.deltaY > 0 ? 0.8 : 1.25;
        const newZoom = Math.max(1, Math.min(timelineZoom.level * zoomDelta, 20));

        // Zoom towards mouse position
        const mouseX = getMouseX(e);
        const mouseTimeRatio = (timelineZoom.panOffset + mouseX) / (280 * timelineZoom.level);

        timelineZoom.level = newZoom;
        timelineZoom.panOffset = Math.max(0, mouseTimeRatio * (280 * newZoom) - mouseX);

        renderTimeline();
      } else if (timelineZoom.level > 1) {
        // Pan with scroll when zoomed
        const maxPan = 280 * timelineZoom.level - 280;
        timelineZoom.panOffset = Math.max(0, Math.min(timelineZoom.panOffset + e.deltaX + e.deltaY, maxPan));
        renderTimeline();
      }
    }, { passive: false });

    // Set initial cursor
    timelineChart.style.cursor = 'crosshair';
  }

  // ========== CHANGE HISTORY TRACKING ==========

  // Get a descriptive selector for an element
  function getElementSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return 'unknown';

    const tag = element.tagName.toLowerCase();
    let selector = tag;

    if (element.id) {
      selector = `#${element.id}`;
    } else if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) selector = `${tag}.${classes}`;
    }

    // Add position info if there are siblings
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    return selector.substring(0, 40); // Truncate for display
  }

  // Get change type description
  function getChangeType(mutation) {
    if (mutation.type === 'childList') {
      if (mutation.addedNodes.length > 0) return 'added';
      if (mutation.removedNodes.length > 0) return 'removed';
    }
    if (mutation.type === 'attributes') return 'style';
    if (mutation.type === 'characterData') return 'text';
    return 'changed';
  }

  // Record a visual change
  function recordVisualChange(element, changeType, timestamp) {
    if (!element) return;

    // Skip recording when not recording or domain is ignored
    if (!isRecording || isDomainIgnored) return;

    // Don't track changes after 8 seconds
    if (timestamp > MAX_METRIC_DURATION) {
      return;
    }

    // Exclude plugin's own elements (highlight overlay, widget, etc.)
    if (shouldIgnoreMutation(element)) {
      return;
    }

    const entry = {
      id: Date.now() + Math.random(),
      timestamp: timestamp,
      element: element,
      selector: getElementSelector(element),
      type: changeType,
      tagName: element.tagName ? element.tagName.toLowerCase() : 'text'
    };

    changeHistory.unshift(entry);

    // Limit history size
    if (changeHistory.length > MAX_HISTORY_ITEMS) {
      changeHistory.pop();
    }

    // Update last change timestamp and stable state
    lastChangeTimestamp = timestamp;
    updateStableState(false);

    // Reset stable state timer
    if (stableStateTimer) {
      clearTimeout(stableStateTimer);
    }
    stableStateTimer = setTimeout(() => {
      updateStableState(true);
    }, STABLE_STATE_THRESHOLD);

    // Update the UI
    renderChangeHistory();
  }

  // Update stable state indicator
  function updateStableState(isStable) {
    const indicator = document.getElementById('stable-indicator');
    if (indicator) {
      if (isStable) {
        indicator.className = 'stable-indicator stable';
        indicator.title = 'Page is visually stable';
      } else {
        indicator.className = 'stable-indicator changing';
        indicator.title = 'Visual changes detected';
      }
    }
  }

  // Render the change history list
  function renderChangeHistory() {
    const listEl = document.getElementById('change-history-list');
    if (!listEl) return;

    if (changeHistory.length === 0) {
      listEl.innerHTML = '<div class="change-history-empty">No visual changes detected yet</div>';
      return;
    }

    // Deduplicate changes at the same time (within 50ms threshold)
    // Prefer non-"removed" changes when there are multiple at same time
    const TIME_GROUP_THRESHOLD = 50;
    const deduplicatedChanges = [];
    const sortedChanges = [...changeHistory].sort((a, b) => a.timestamp - b.timestamp);

    sortedChanges.forEach(change => {
      // Find existing group within threshold
      const existingGroup = deduplicatedChanges.find(g =>
        Math.abs(g.timestamp - change.timestamp) <= TIME_GROUP_THRESHOLD
      );

      if (existingGroup) {
        // If current is not 'removed' and existing is 'removed', replace it
        if (change.type !== 'removed' && existingGroup.type === 'removed') {
          existingGroup.entry = change;
          existingGroup.type = change.type;
          existingGroup.timestamp = change.timestamp;
        }
        // Otherwise keep the existing one (first non-removed wins)
      } else {
        deduplicatedChanges.push({
          timestamp: change.timestamp,
          type: change.type,
          entry: change
        });
      }
    });

    // Sort by timestamp ascending for eye icon logic, then reverse for display
    const sortedByTimeAsc = [...deduplicatedChanges].sort((a, b) => a.timestamp - b.timestamp);

    // Get LPC time for eye icon logic
    const metrics = currentMode === 'page-load' ? pageLoadMetrics : navigationMetrics;
    const lpcTime = metrics['last-pixel-change'];
    const EYE_THRESHOLD = 500; // 500ms threshold for showing eye icon

    // Find the entry that matches or is closest to the LPC timestamp
    // Note: LPC timestamp is set ~300ms AFTER the actual last change (due to inactivity threshold)
    // So we need to look for changes around lpcTime - 300ms
    const INACTIVITY_OFFSET = 300;
    let lpcEntryId = null;
    if (lpcTime !== null && lpcTime !== undefined && sortedByTimeAsc.length > 0) {
      const adjustedLpcTime = lpcTime - INACTIVITY_OFFSET;

      // Find the change closest to the adjusted LPC time (within 150ms tolerance)
      let closestDiff = Infinity;
      sortedByTimeAsc.forEach(group => {
        const diff = Math.abs(group.timestamp - adjustedLpcTime);
        if (diff < closestDiff && diff <= 150) {
          closestDiff = diff;
          lpcEntryId = group.entry.id;
        }
      });

      // If no close match to adjusted time, try matching directly to LPC time
      if (lpcEntryId === null) {
        sortedByTimeAsc.forEach(group => {
          const diff = Math.abs(group.timestamp - lpcTime);
          if (diff < closestDiff && diff <= 150) {
            closestDiff = diff;
            lpcEntryId = group.entry.id;
          }
        });
      }

      // If still no match, use the last change before or at LPC time
      if (lpcEntryId === null && sortedByTimeAsc.length > 0) {
        // Just use the most recent change (last in sorted ascending order)
        lpcEntryId = sortedByTimeAsc[sortedByTimeAsc.length - 1].entry.id;
      }
    }

    // Determine which items should show the eye icon
    const itemsWithEye = new Set();
    sortedByTimeAsc.forEach((group, index) => {
      let hasChangeWithin500ms = false;

      // Check if any subsequent change is within 500ms
      for (let i = index + 1; i < sortedByTimeAsc.length; i++) {
        if (sortedByTimeAsc[i].timestamp - group.timestamp <= EYE_THRESHOLD) {
          hasChangeWithin500ms = true;
          break;
        }
      }

      // Check if LPC is within 500ms after this change
      if (!hasChangeWithin500ms && lpcTime !== null && lpcTime !== undefined) {
        if (lpcTime > group.timestamp && lpcTime - group.timestamp <= EYE_THRESHOLD) {
          hasChangeWithin500ms = true;
        }
      }

      if (!hasChangeWithin500ms) {
        itemsWithEye.add(group.entry.id);
      }
    });

    // Sort by timestamp descending (most recent first) and take top 20
    const displayChanges = deduplicatedChanges
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const html = displayChanges.map((group, index) => {
      const entry = group.entry;
      const timeStr = formatTime(entry.timestamp);
      const typeClass = `change-type-${entry.type}`;
      const hasEye = itemsWithEye.has(entry.id);
      const isLpc = entry.id === lpcEntryId;
      const eyeIcon = hasEye ? '<span class="change-eye" title="No visual changes for 500ms+ after this point">👁</span>' : '';
      const lpcBadge = isLpc ? '<span class="change-lpc-badge" title="Last Pixel Change">LPC</span>' : '';
      return `
        <div class="change-history-item ${typeClass}${hasEye ? ' has-eye' : ''}${isLpc ? ' is-lpc' : ''}" data-id="${entry.id}" title="Click to highlight element">
          <span class="change-time">${timeStr}</span>
          ${lpcBadge}
          ${eyeIcon}
          <span class="change-type">${entry.type}</span>
          <span class="change-selector">&lt;${entry.tagName}&gt; ${entry.selector}</span>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    // Add click handlers for highlighting
    listEl.querySelectorAll('.change-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseFloat(item.dataset.id);
        const entry = changeHistory.find(e => e.id === id);
        if (entry && entry.element) {
          highlightElement(entry.element);
        }
      });
    });
  }

  // Highlight an element on the page
  function highlightElement(element) {
    // Remove previous highlight
    removeHighlight();

    if (!element || !element.getBoundingClientRect) return;

    try {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Create highlight overlay
      highlightOverlay = document.createElement('div');
      highlightOverlay.id = 'perf-tracker-highlight';
      highlightOverlay.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: rgba(99, 102, 241, 0.3);
        border: 2px solid #6366f1;
        border-radius: 4px;
        pointer-events: none;
        z-index: 999998;
        transition: all 0.2s ease;
        box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
      `;

      // Add label
      const label = document.createElement('div');
      label.style.cssText = `
        position: absolute;
        top: -24px;
        left: 0;
        background: #6366f1;
        color: white;
        padding: 2px 8px;
        font-size: 11px;
        border-radius: 3px;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      label.textContent = getElementSelector(element);
      highlightOverlay.appendChild(label);

      document.body.appendChild(highlightOverlay);
      highlightedElement = element;

      // Scroll element into view if needed
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Auto-remove highlight after 3 seconds
      setTimeout(removeHighlight, 3000);
    } catch (e) {
      console.log('[Performance Tracker] Could not highlight element:', e);
    }
  }

  // Remove highlight overlay
  function removeHighlight() {
    if (highlightOverlay && highlightOverlay.parentNode) {
      highlightOverlay.parentNode.removeChild(highlightOverlay);
    }
    highlightOverlay = null;
    highlightedElement = null;
  }

  // ========== END CHANGE HISTORY TRACKING ==========

  // ========== LCP CANDIDATES TRACKING ==========

  // Record an LCP candidate
  function recordLcpCandidate(entry, isNavigation = false) {
    const time = entry.renderTime || entry.loadTime;

    // Don't track LCP candidates after 8 seconds
    if (time > MAX_METRIC_DURATION) {
      return;
    }

    const element = entry.element;
    if (!element) return;

    // Get element info
    const tagName = element.tagName ? element.tagName.toLowerCase() : 'unknown';
    const size = entry.size || 0;
    const url = entry.url || '';

    // Create candidate entry
    const candidate = {
      id: Date.now() + Math.random(),
      timestamp: time,
      element: element,
      selector: getElementSelector(element),
      tagName: tagName,
      size: size,
      url: url,
      isNavigation: isNavigation
    };

    // Add to candidates list
    lcpCandidates.push(candidate);

    // Update the UI
    renderLcpHistory();
  }

  // Render the LCP candidates list
  function renderLcpHistory() {
    const listEl = document.getElementById('lcp-history-list');
    const countEl = document.getElementById('lcp-count');

    if (!listEl) return;

    // Update count
    if (countEl) {
      countEl.textContent = lcpCandidates.length;
    }

    if (lcpCandidates.length === 0) {
      listEl.innerHTML = '<div class="lcp-history-empty">No LCP candidates detected yet</div>';
      return;
    }

    // Sort by timestamp (latest first) - descending order
    const sortedCandidates = [...lcpCandidates].sort((a, b) => b.timestamp - a.timestamp);
    const latestCandidate = sortedCandidates[0]; // Latest is now first

    const html = sortedCandidates.map((candidate, index) => {
      const timeStr = formatTime(candidate.timestamp);
      const sizeStr = formatSize(candidate.size);
      const isLatest = candidate === latestCandidate;
      const latestClass = isLatest ? 'lcp-latest' : '';
      const modeClass = candidate.isNavigation ? 'lcp-navigation' : 'lcp-pageload';
      // Calculate original order (1 = earliest)
      const originalOrder = sortedCandidates.length - index;

      // Truncate URL for display
      let urlDisplay = '';
      if (candidate.url) {
        const urlObj = new URL(candidate.url, window.location.origin);
        urlDisplay = urlObj.pathname.split('/').pop() || urlObj.pathname;
        if (urlDisplay.length > 20) {
          urlDisplay = '...' + urlDisplay.slice(-17);
        }
      }

      return `
        <div class="lcp-history-item ${latestClass} ${modeClass}" data-index="${index}" title="Click to highlight element">
          <div class="lcp-item-header">
            <span class="lcp-time">${timeStr}</span>
            <span class="lcp-size">${sizeStr}</span>
            ${isLatest ? '<span class="lcp-badge">Current LCP</span>' : `<span class="lcp-order">#${originalOrder}</span>`}
          </div>
          <div class="lcp-item-details">
            <span class="lcp-tag">&lt;${candidate.tagName}&gt;</span>
            <span class="lcp-selector">${candidate.selector}</span>
          </div>
          ${urlDisplay ? `<div class="lcp-item-url" title="${candidate.url}">${urlDisplay}</div>` : ''}
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    // Add click handlers for highlighting
    listEl.querySelectorAll('.lcp-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        const sortedCandidates = [...lcpCandidates].sort((a, b) => b.timestamp - a.timestamp);
        const candidate = sortedCandidates[index];
        if (candidate && candidate.element) {
          highlightLcpElement(candidate.element);
        }
      });
    });
  }

  // Format size in KB
  function formatSize(size) {
    if (!size || size === 0) return '-';
    if (size < 1000) return size + ' px²';
    if (size < 1000000) return (size / 1000).toFixed(1) + 'K px²';
    return (size / 1000000).toFixed(2) + 'M px²';
  }

  // Highlight an LCP element on the page
  function highlightLcpElement(element) {
    // Remove previous highlight
    removeLcpHighlight();

    if (!element || !element.getBoundingClientRect) return;

    try {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Create highlight overlay
      lcpHighlightOverlay = document.createElement('div');
      lcpHighlightOverlay.id = 'perf-tracker-lcp-highlight';
      lcpHighlightOverlay.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: rgba(245, 158, 11, 0.3);
        border: 3px solid #f59e0b;
        border-radius: 4px;
        pointer-events: none;
        z-index: 999998;
        transition: all 0.2s ease;
        box-shadow: 0 0 15px rgba(245, 158, 11, 0.6);
      `;

      // Add label
      const label = document.createElement('div');
      label.style.cssText = `
        position: absolute;
        top: -28px;
        left: 0;
        background: #f59e0b;
        color: white;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 3px;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      `;
      label.textContent = 'LCP Element: ' + getElementSelector(element);
      lcpHighlightOverlay.appendChild(label);

      document.body.appendChild(lcpHighlightOverlay);

      // Scroll element into view if needed
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Auto-remove highlight after 4 seconds
      setTimeout(removeLcpHighlight, 4000);
    } catch (e) {
      console.log('[Performance Tracker] Could not highlight LCP element:', e);
    }
  }

  // Remove LCP highlight overlay
  function removeLcpHighlight() {
    if (lcpHighlightOverlay && lcpHighlightOverlay.parentNode) {
      lcpHighlightOverlay.parentNode.removeChild(lcpHighlightOverlay);
    }
    lcpHighlightOverlay = null;
  }

  // Clear LCP candidates (for navigation reset)
  function clearLcpCandidates() {
    lcpCandidates.length = 0;
    renderLcpHistory();
    removeLcpHighlight();
  }

  // ========== END LCP CANDIDATES TRACKING ==========

  // Update mode display
  function updateModeDisplay() {
    const modeBadge = document.getElementById('mode-badge');
    const navCount = document.getElementById('nav-count');
    
    if (currentMode === 'page-load') {
      modeBadge.textContent = 'Page Load';
      modeBadge.className = 'mode-badge page-load';
      navCount.textContent = '';
    } else {
      modeBadge.textContent = 'Navigation';
      modeBadge.className = 'mode-badge navigation';
      navCount.textContent = navigationCount > 0 ? `#${navigationCount}` : '';
    }
  }

  // Metric color mapping (same as timeline)
  const metricColors = {
    'ttfb': '#a855f7',
    'first-paint': '#8b5cf6',
    'fcp': '#3b82f6',
    'dom-ready': '#10b981',
    'lcp': '#f59e0b',
    'load-complete': '#ef4444',
    'tti': '#6366f1',
    'tbt': '#ec4899',
    'cls': '#14b8a6',
    'inp': '#f472b6',
    'dom-size': '#84cc16',
    'last-pixel-change': '#06b6d4'
  };

  // Initialize color indicators
  function initializeColorIndicators() {
    Object.keys(metricColors).forEach(key => {
      const colorIndicator = document.querySelector(`.metric-color-indicator[data-metric="${key}"]`);
      if (colorIndicator && metricColors[key]) {
        colorIndicator.style.backgroundColor = metricColors[key];
      }
    });
  }

  // Display metrics based on current mode
  function displayMetrics() {
    const metrics = currentMode === 'page-load' ? pageLoadMetrics : navigationMetrics;
    
    // Define all metric keys to ensure we display all of them
    const metricKeys = ['ttfb', 'first-paint', 'fcp', 'dom-ready', 'lcp', 'load-complete', 'tti', 'tbt', 'cls', 'inp', 'dom-size', 'last-pixel-change'];
    
    metricKeys.forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (metrics[key] !== null && metrics[key] !== undefined) {
          // DOM size is displayed as a count, not time
          if (key === 'dom-size') {
            element.textContent = metrics[key].toLocaleString();
          } else {
            element.textContent = formatTime(metrics[key]);
          }
          // Color code based on performance thresholds
          const rating = getPerformanceRating(key, metrics[key]);
          element.className = 'metric-value ' + rating;
        } else {
          // INP requires user interaction, show "waiting..." instead of "-"
          element.textContent = key === 'inp' ? 'waiting...' : '-';
          element.className = 'metric-value';
        }
      }
    });
    
    // Update timeline when metrics change
    renderTimeline();
  }

  // Render timeline chart with zoom and pan support
  function renderTimeline() {
    const metrics = currentMode === 'page-load' ? pageLoadMetrics : navigationMetrics;
    const timelineChart = document.getElementById('timeline-chart');
    const timelineContainer = document.getElementById('timeline-container');
    const zoomLevelDisplay = document.getElementById('zoom-level');

    if (!timelineChart) return;

    // Make sure timeline container is visible
    if (timelineContainer) {
      timelineContainer.style.display = 'block';
    }

    // Update zoom level display
    if (zoomLevelDisplay) {
      zoomLevelDisplay.textContent = `${timelineZoom.level.toFixed(1)}x`;
    }

    // Define timeline metrics (exclude TBT and CLS as they're not time-based)
    const timelineMetrics = [
      { key: 'ttfb', label: 'TTFB', order: 0 },
      { key: 'first-paint', label: 'FP', order: 1 },
      { key: 'fcp', label: 'FCP', order: 2 },
      { key: 'dom-ready', label: 'DOM', order: 3 },
      { key: 'lcp', label: 'LCP', order: 4 },
      { key: 'load-complete', label: 'Load', order: 5 },
      { key: 'tti', label: 'TTI', order: 6 },
      { key: 'last-pixel-change', label: 'LPC', order: 7 }
    ];

    // Filter out metrics that don't have values (allow 0 values)
    const availableMetrics = timelineMetrics.filter(m =>
      metrics[m.key] !== null && metrics[m.key] !== undefined && !isNaN(metrics[m.key])
    );

    if (availableMetrics.length === 0) {
      const emptyMessage = currentMode === 'navigation'
        ? (navigationCount > 0
          ? 'Navigation metrics are being tracked...'
          : 'No navigation detected yet. Navigate to see metrics.')
        : 'No metrics available yet';
      timelineChart.innerHTML = `<div class="timeline-empty">${emptyMessage}</div><div class="timeline-selection" id="timeline-selection"></div>`;
      return;
    }

    // Find the maximum time value for scaling (include visual changes)
    const metricMaxTime = Math.max(...availableMetrics.map(m => metrics[m.key]));
    const changeMaxTime = changeHistory.length > 0
      ? Math.max(...changeHistory.map(c => c.timestamp))
      : 0;
    const maxTime = Math.max(metricMaxTime, changeMaxTime);
    // Add some padding (10%) to the max time for better visualization
    const paddedMaxTime = maxTime * 1.1;
    const baseTimelineWidth = 280; // Base width of timeline in pixels

    // Apply zoom - effective width increases with zoom
    const effectiveWidth = baseTimelineWidth * timelineZoom.level;

    // Calculate visible time range based on zoom and pan
    const visibleStartTime = (timelineZoom.panOffset / effectiveWidth) * paddedMaxTime;
    const visibleEndTime = ((timelineZoom.panOffset + baseTimelineWidth) / effectiveWidth) * paddedMaxTime;

    // Clear previous content but preserve selection element
    timelineChart.innerHTML = '';

    // Create timeline viewport (clips content)
    const viewport = document.createElement('div');
    viewport.className = 'timeline-viewport';

    // Create scrollable content container
    const content = document.createElement('div');
    content.className = 'timeline-content';
    content.style.width = `${effectiveWidth}px`;
    content.style.transform = `translateX(-${timelineZoom.panOffset}px)`;

    // Create timeline axis
    const axis = document.createElement('div');
    axis.className = 'timeline-axis';
    axis.style.width = `${effectiveWidth}px`;
    content.appendChild(axis);

    // Create timeline bars for each metric with matching legend colors
    availableMetrics.forEach((metric) => {
      const time = metrics[metric.key];
      const position = (time / paddedMaxTime) * effectiveWidth;

      // Use the same color as the metric legend
      const metricColor = metricColors[metric.key] || '#6b7280';
      const perfRating = getPerformanceRating(metric.key, time);

      // Create timeline bar
      const bar = document.createElement('div');
      bar.className = `timeline-bar ${perfRating}`;
      bar.style.left = `${position}px`;
      bar.style.backgroundColor = metricColor;
      bar.title = `${metric.label}: ${formatTime(time)} (${perfRating.replace('-', ' ')})`;
      bar.dataset.metric = metric.key;

      // Make LPC bar same height as visual change bars and add eye icon
      if (metric.key === 'last-pixel-change') {
        bar.style.height = '25px';
        bar.classList.add('timeline-change-bar');
        bar.classList.add('lpc-bar');
        // Always add eye icon to LPC since it's the last visual change by definition
        const eyeIcon = document.createElement('div');
        eyeIcon.className = 'change-eye-icon lpc-eye-icon';
        eyeIcon.innerHTML = '👁';
        eyeIcon.title = 'Last Pixel Change - final visual stability point';
        bar.appendChild(eyeIcon);
      }

      // Create marker with matching legend color
      const marker = document.createElement('div');
      marker.className = `timeline-marker ${perfRating}`;
      marker.style.backgroundColor = metricColor;
      marker.innerHTML = `<span class="marker-label">${metric.label}</span><span class="marker-indicator"></span>`;

      // Create vertical line
      const line = document.createElement('div');
      line.className = 'timeline-line';
      line.style.left = `${position}px`;
      line.style.backgroundColor = metricColor;

      bar.appendChild(marker);
      content.appendChild(bar);
      content.appendChild(line);
    });

    // Add visual changes to timeline (grouped by similar times)
    const visualChangeColor = metricColors['last-pixel-change']; // Same color as Last Pixel Change metric
    const TIME_GROUP_THRESHOLD = 50; // Group changes within 50ms

    // Group visual changes by similar timestamps
    const groupedChanges = [];
    const sortedChanges = [...changeHistory].sort((a, b) => a.timestamp - b.timestamp);

    sortedChanges.forEach(change => {
      // Only include changes within the max time range
      if (change.timestamp > paddedMaxTime) return;

      // Find existing group within threshold
      const existingGroup = groupedChanges.find(g =>
        Math.abs(g.timestamp - change.timestamp) <= TIME_GROUP_THRESHOLD
      );

      if (existingGroup) {
        existingGroup.count++;
        existingGroup.changes.push(change);
        // Update timestamp to average
        existingGroup.timestamp = existingGroup.changes.reduce((sum, c) => sum + c.timestamp, 0) / existingGroup.changes.length;
      } else {
        groupedChanges.push({
          timestamp: change.timestamp,
          count: 1,
          changes: [change]
        });
      }
    });

    // Get LPC time for "eye" icon logic
    const lpcTime = metrics['last-pixel-change'];
    const EYE_THRESHOLD = 500; // 500ms threshold for showing eye icon

    // Draw visual change bars
    groupedChanges.forEach((group, index) => {
      const position = (group.timestamp / paddedMaxTime) * effectiveWidth;

      // Create short bar for visual changes (half height)
      const changeBar = document.createElement('div');
      changeBar.className = 'timeline-bar timeline-change-bar';
      changeBar.style.left = `${position}px`;
      changeBar.style.backgroundColor = visualChangeColor;
      changeBar.style.height = '25px'; // Half height
      changeBar.style.opacity = Math.min(0.4 + (group.count * 0.1), 0.9).toString(); // More opacity for more changes

      // Build tooltip with change details
      const changeTypes = group.changes.map(c => c.type);
      const uniqueTypes = [...new Set(changeTypes)];
      const typesSummary = uniqueTypes.join(', ');
      changeBar.title = `Visual Changes: ${group.count} change${group.count > 1 ? 's' : ''} at ${formatTime(group.timestamp)}\nTypes: ${typesSummary}`;

      // Add count badge if multiple changes
      if (group.count > 1) {
        const countBadge = document.createElement('div');
        countBadge.className = 'change-count-badge';
        countBadge.textContent = group.count.toString();
        changeBar.appendChild(countBadge);
      }

      // Check if there's no other visual change or LPC within 500ms after this bar
      // to show the "eye" icon (indicating potential visual stability point)
      let hasChangeWithin500ms = false;

      // Check if any subsequent visual change group is within 500ms
      for (let i = index + 1; i < groupedChanges.length; i++) {
        if (groupedChanges[i].timestamp - group.timestamp <= EYE_THRESHOLD) {
          hasChangeWithin500ms = true;
          break;
        }
      }

      // Check if LPC is within 500ms after this change
      if (!hasChangeWithin500ms && lpcTime !== null && lpcTime !== undefined) {
        if (lpcTime > group.timestamp && lpcTime - group.timestamp <= EYE_THRESHOLD) {
          hasChangeWithin500ms = true;
        }
      }

      // If no changes within 500ms, add eye icon
      if (!hasChangeWithin500ms) {
        const eyeIcon = document.createElement('div');
        eyeIcon.className = 'change-eye-icon';
        eyeIcon.innerHTML = '👁';
        eyeIcon.title = 'No visual changes for 500ms+ after this point';
        changeBar.appendChild(eyeIcon);
      }

      // Create thin vertical line for visual change
      const changeLine = document.createElement('div');
      changeLine.className = 'timeline-line timeline-change-line';
      changeLine.style.left = `${position}px`;
      changeLine.style.backgroundColor = visualChangeColor;
      changeLine.style.height = '20px';
      changeLine.style.opacity = '0.2';

      content.appendChild(changeBar);
      content.appendChild(changeLine);
    });

    // Draw custom measure overlays (time ranges with light background)
    customMeasures.forEach((measure, index) => {
      const startPos = (measure.startTime / paddedMaxTime) * effectiveWidth;
      const endPos = ((measure.startTime + measure.duration) / paddedMaxTime) * effectiveWidth;
      const width = Math.max(endPos - startPos, 2); // Minimum 2px width

      const measureOverlay = document.createElement('div');
      measureOverlay.className = 'custom-measure-overlay';
      measureOverlay.style.left = `${startPos}px`;
      measureOverlay.style.width = `${width}px`;
      // Cycle through colors for multiple measures
      const colors = ['rgba(139, 92, 246, 0.15)', 'rgba(34, 197, 94, 0.15)', 'rgba(249, 115, 22, 0.15)', 'rgba(236, 72, 153, 0.15)'];
      measureOverlay.style.backgroundColor = colors[index % colors.length];
      measureOverlay.title = `${measure.name}: ${formatTime(measure.startTime)} → ${formatTime(measure.startTime + measure.duration)} (${formatTime(measure.duration)})`;

      // Add measure label
      const measureLabel = document.createElement('div');
      measureLabel.className = 'custom-measure-label';
      measureLabel.textContent = measure.name;
      measureOverlay.appendChild(measureLabel);

      content.appendChild(measureOverlay);
    });

    // Draw custom mark pins
    customMarks.forEach((mark, index) => {
      const position = (mark.timestamp / paddedMaxTime) * effectiveWidth;

      // Create pin marker
      const markPin = document.createElement('div');
      markPin.className = 'custom-mark-pin';
      markPin.style.left = `${position}px`;
      // Cycle through colors for multiple marks
      const colors = ['#8b5cf6', '#22c55e', '#f97316', '#ec4899', '#06b6d4'];
      markPin.style.setProperty('--pin-color', colors[index % colors.length]);
      markPin.title = `${mark.name}: ${formatTime(mark.timestamp)}`;

      // Pin head
      const pinHead = document.createElement('div');
      pinHead.className = 'custom-mark-pin-head';
      markPin.appendChild(pinHead);

      // Pin label
      const pinLabel = document.createElement('div');
      pinLabel.className = 'custom-mark-pin-label';
      pinLabel.textContent = mark.name;
      markPin.appendChild(pinLabel);

      content.appendChild(markPin);
    });

    // Create x-axis with time labels
    const xAxisContainer = document.createElement('div');
    xAxisContainer.className = 'timeline-x-axis';
    xAxisContainer.style.width = `${effectiveWidth}px`;

    // X-axis line
    const xAxisLine = document.createElement('div');
    xAxisLine.className = 'x-axis-line';
    xAxisContainer.appendChild(xAxisLine);

    // Activity Heat Strip - shows page activity intensity over time
    // Using 200ms intervals (5 per second) for balanced activity visualization
    const INTERVAL_MS = 200;
    const numBuckets = Math.max(1, Math.ceil(paddedMaxTime / INTERVAL_MS));
    const densityBuckets = new Array(numBuckets).fill(0);

    // Count metrics in each bucket (each metric = 1 point)
    availableMetrics.forEach(metric => {
      const time = metrics[metric.key];
      const bucketIndex = Math.min(Math.floor(time / INTERVAL_MS), numBuckets - 1);
      densityBuckets[bucketIndex] += 1;
    });

    // Count visual changes in each bucket (each change = 0.5 points)
    changeHistory.forEach(change => {
      if (change.timestamp <= paddedMaxTime) {
        const bucketIndex = Math.min(Math.floor(change.timestamp / INTERVAL_MS), numBuckets - 1);
        densityBuckets[bucketIndex] += 0.5;
      }
    });

    // Create heat strip container
    const heatStrip = document.createElement('div');
    heatStrip.className = 'timeline-heat-strip';
    heatStrip.style.width = `${effectiveWidth}px`;

    // Find max density for scaling opacity
    const maxDensity = Math.max(...densityBuckets, 1);

    // Create individual heat segments - single red color with intensity based on activity
    // More activity = darker/more opaque red (like layers stacking up)
    densityBuckets.forEach((density, index) => {
      const segment = document.createElement('div');
      segment.className = 'heat-segment';

      const segmentWidth = effectiveWidth / numBuckets;
      segment.style.width = `${segmentWidth}px`;
      segment.style.left = `${index * segmentWidth}px`;

      // Calculate opacity based on activity (0.1 min for visibility, 1.0 max)
      // Use square root for better visual distribution (makes low values more visible)
      const normalizedDensity = density / maxDensity;
      const opacity = density === 0 ? 0.08 : 0.15 + (Math.sqrt(normalizedDensity) * 0.85);
      segment.style.opacity = opacity.toFixed(2);

      // Tooltip showing time range and activity
      const startTime = (index * INTERVAL_MS / 1000).toFixed(1);
      const endTime = ((index + 1) * INTERVAL_MS / 1000).toFixed(1);
      const activityCount = Math.round(density * 10) / 10;
      segment.title = `${startTime}s - ${endTime}s: ${activityCount} events`;

      heatStrip.appendChild(segment);
    });

    xAxisContainer.appendChild(heatStrip);

    // Calculate appropriate tick interval based on max time and zoom
    const numTicks = Math.max(4, Math.min(Math.floor(5 * timelineZoom.level), 10));
    const tickInterval = paddedMaxTime / numTicks;

    // Add tick marks and labels
    for (let i = 0; i <= numTicks; i++) {
      const time = i * tickInterval;
      const position = (time / paddedMaxTime) * effectiveWidth;

      // Tick mark
      const tick = document.createElement('div');
      tick.className = 'x-axis-tick';
      tick.style.left = `${position}px`;
      xAxisContainer.appendChild(tick);

      // Time label
      const label = document.createElement('div');
      label.className = 'x-axis-label';
      label.style.left = `${position}px`;
      label.textContent = formatTime(time);
      xAxisContainer.appendChild(label);
    }

    // Add "Time" label at the end
    const axisTitle = document.createElement('div');
    axisTitle.className = 'x-axis-title';
    axisTitle.textContent = 'Time →';
    xAxisContainer.appendChild(axisTitle);

    content.appendChild(xAxisContainer);

    viewport.appendChild(content);
    timelineChart.appendChild(viewport);

    // Re-add selection element for drag-to-zoom
    const selection = document.createElement('div');
    selection.className = 'timeline-selection';
    selection.id = 'timeline-selection';
    timelineChart.appendChild(selection);

    // Add zoom indicator if zoomed
    if (timelineZoom.level > 1) {
      const zoomIndicator = document.createElement('div');
      zoomIndicator.className = 'timeline-zoom-indicator';
      zoomIndicator.innerHTML = `
        <span class="zoom-range">${formatTime(visibleStartTime)} - ${formatTime(visibleEndTime)}</span>
      `;
      timelineChart.appendChild(zoomIndicator);
    }
  }

  // Reset timeline zoom
  function resetTimelineZoom() {
    timelineZoom.level = 1;
    timelineZoom.panOffset = 0;
    renderTimeline();
  }

  // Zoom to selection
  function zoomToSelection(startX, endX, chartWidth) {
    const selectionWidth = Math.abs(endX - startX);
    if (selectionWidth < 10) return; // Minimum selection size

    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);

    // Calculate new zoom level
    const newZoom = Math.min(chartWidth / selectionWidth * timelineZoom.level, 20); // Max 20x zoom

    // Calculate new pan offset to center the selection
    const selectionCenter = (minX + maxX) / 2;
    const currentTimePosition = (timelineZoom.panOffset + selectionCenter) / (280 * timelineZoom.level);
    const newPanOffset = currentTimePosition * (280 * newZoom) - (chartWidth / 2);

    timelineZoom.level = newZoom;
    timelineZoom.panOffset = Math.max(0, Math.min(newPanOffset, 280 * newZoom - chartWidth));

    renderTimeline();
  }

  // Update metric
  function updateMetric(id, value, isNavigation = false) {
    // Skip updates when not recording or domain is ignored
    if (!isRecording || isDomainIgnored) return;

    // Ignore time-based metrics above 8 seconds (CLS is a score, not time-based)
    // Skip duration cap for non-time metrics (CLS and DOM size)
    if (id !== 'cls' && id !== 'dom-size' && value > MAX_METRIC_DURATION) {
      console.log(`[Performance Tracker] Ignoring ${id}: ${value}ms exceeds ${MAX_METRIC_DURATION}ms cap`);
      return;
    }

    const targetMetrics = isNavigation ? navigationMetrics : pageLoadMetrics;
    targetMetrics[id] = value;

    // Only update display if we're viewing the correct mode
    if ((isNavigation && currentMode === 'navigation') ||
        (!isNavigation && currentMode === 'page-load')) {
      const element = document.getElementById(id);
      if (element) {
        // DOM size is displayed as a count, not time
        if (id === 'dom-size') {
          element.textContent = value.toLocaleString();
        } else {
          element.textContent = formatTime(value);
        }
        // Color code based on performance thresholds
        const rating = getPerformanceRating(id, value);
        element.className = 'metric-value ' + rating;
      }
      // Update timeline when metrics change in the current mode
      renderTimeline();

      // When LPC is updated, re-render change history to show the LPC badge
      if (id === 'last-pixel-change') {
        renderChangeHistory();
      }
    }
  }

  function formatTime(ms) {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) {
      return ms.toFixed(0) + 'ms';
    }
    return (ms / 1000).toFixed(2) + 's';
  }

  // Pause tracking - stops collecting new metrics
  function pauseTracking() {
    console.log('[perf-vibe] Recording paused');
    // The isRecording flag is checked in updateMetric and recordVisualChange
    // to skip new data collection
  }

  // Resume tracking - continues collecting metrics
  function resumeTracking() {
    console.log('[perf-vibe] Recording resumed');
    // Recording continues from current state
  }

  // Initialize performance observers
  function initPerformanceObservers(isNavigation = false) {
    // Reset observers for navigation
    if (isNavigation) {
      // Disconnect existing observers
      if (fcpObserver) {
        try { fcpObserver.disconnect(); } catch(e) {}
      }
      if (lcpObserver) {
        try { lcpObserver.disconnect(); } catch(e) {}
      }
      if (clsObserver) {
        try { clsObserver.disconnect(); } catch(e) {}
      }
      if (longTaskObserver) {
        try { longTaskObserver.disconnect(); } catch(e) {}
      }
    }

    try {
      // First Contentful Paint
      // Note: Performance Observer only works for initial page load
      // For navigation, we use MutationObserver-based detection
      if (!isNavigation) {
        fcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            if (entry.name === 'first-contentful-paint') {
              updateMetric('fcp', entry.startTime, false);
            }
          });
        });
        fcpObserver.observe({ entryTypes: ['paint'] });
      }

      // Largest Contentful Paint
      // Note: Performance Observer only works for initial page load
      // For navigation, we use MutationObserver-based detection
      if (!isNavigation) {
        lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          // Track all LCP candidates for history
          entries.forEach((entry) => {
            recordLcpCandidate(entry, false);
          });
          // Update the LCP metric with the latest entry
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            const time = lastEntry.renderTime || lastEntry.loadTime;
            updateMetric('lcp', time, false);
          }
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      }

      // Layout Shift
      clsObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            updateMetric('cls', clsValue, isNavigation);
          }
        });
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });

      // Long Tasks (for TBT calculation)
      longTaskObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.duration > 50) {
            longTasks.push(entry);
            const tbt = longTasks.reduce((sum, task) => sum + (task.duration - 50), 0);
            updateMetric('tbt', tbt, isNavigation);
          }
        });
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });

      // INP Observer - tracks interaction latency (worst interaction)
      inpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          // Only count interactions with input (click, keydown, pointerdown, etc.)
          if (entry.duration > worstInp) {
            worstInp = entry.duration;
            updateMetric('inp', worstInp, isNavigation);
          }
        });
      });
      inpObserver.observe({ type: 'event', durationThreshold: 16, buffered: true });

    } catch (e) {
      console.log('Some performance metrics not available:', e);
    }
  }

  // Initialize custom metric observer for user-defined marks and measures
  function initCustomMetricObserver() {
    // Disconnect existing observer
    if (customMetricObserver) {
      try { customMetricObserver.disconnect(); } catch(e) {}
    }

    // Clear existing custom metrics
    customMarks = [];
    customMeasures = [];

    // If no custom metrics configured, skip
    if (customMetricNames.length === 0) {
      renderTimeline();
      return;
    }

    try {
      // Check for existing marks/measures that were recorded before observer started
      const existingMarks = performance.getEntriesByType('mark');
      const existingMeasures = performance.getEntriesByType('measure');

      existingMarks.forEach(entry => {
        if (customMetricNames.some(name => entry.name.includes(name) || name.includes(entry.name))) {
          customMarks.push({
            name: entry.name,
            timestamp: entry.startTime
          });
        }
      });

      existingMeasures.forEach(entry => {
        if (customMetricNames.some(name => entry.name.includes(name) || name.includes(entry.name))) {
          customMeasures.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });

      // Create observer for new marks and measures
      customMetricObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          // Check if this entry matches any custom metric name (partial match)
          const isMatch = customMetricNames.some(name =>
            entry.name.includes(name) || name.includes(entry.name)
          );

          if (isMatch) {
            if (entry.entryType === 'mark') {
              customMarks.push({
                name: entry.name,
                timestamp: entry.startTime
              });
            } else if (entry.entryType === 'measure') {
              customMeasures.push({
                name: entry.name,
                startTime: entry.startTime,
                duration: entry.duration
              });
            }
            // Re-render timeline to show new custom metrics
            renderTimeline();
          }
        });
      });

      customMetricObserver.observe({ entryTypes: ['mark', 'measure'] });

      // Re-render timeline if we found existing metrics
      if (customMarks.length > 0 || customMeasures.length > 0) {
        renderTimeline();
      }
    } catch (e) {
      console.log('Custom metrics observer not available:', e);
    }
  }

  // Check if an element should be ignored (continuously changing elements)
  function shouldIgnoreElement(element) {
    if (!element || !element.nodeType || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    
    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    
    // Ignore video elements
    if (tagName === 'video') {
      return true;
    }
    
    // Ignore canvas elements (might have animations)
    if (tagName === 'canvas') {
      return true;
    }
    
    // Check for animated GIFs
    if (tagName === 'img') {
      const src = element.src || element.getAttribute('src') || '';
      // Check if it's a GIF file
      if (src.toLowerCase().endsWith('.gif') || src.toLowerCase().includes('.gif?')) {
        return true; // Assume GIFs are animated to be safe
      }
    }
    
    // Ignore iframe elements (might contain videos or animated content)
    if (tagName === 'iframe') {
      return true;
    }
    
    // Ignore SVG elements with animations
    if (tagName === 'svg') {
      // Check if SVG has animation elements
      const hasAnimation = element.querySelector('animate, animateTransform, animateMotion');
      if (hasAnimation) {
        return true;
      }
    }
    
    // Check for CSS animations that loop infinitely
    const computedStyle = window.getComputedStyle(element);
    const animationName = computedStyle.animationName;
    const animationIterationCount = computedStyle.animationIterationCount;
    
    // Ignore elements with infinite animations
    if (animationName && animationName !== 'none') {
      if (animationIterationCount === 'infinite' || parseFloat(animationIterationCount) === Infinity) {
        return true;
      }
    }
    
    // Check for elements with video-like attributes or classes
    const className = element.className || '';
    const id = element.id || '';
    if (typeof className === 'string') {
      const lowerClassName = className.toLowerCase();
      if (lowerClassName.includes('video') || 
          lowerClassName.includes('player') ||
          lowerClassName.includes('animation') ||
          lowerClassName.includes('gif') ||
          lowerClassName.includes('carousel') ||
          lowerClassName.includes('slider')) {
        // Check if it's actually a container vs the element itself
        if (tagName !== 'video' && tagName !== 'img') {
          // Might be a container, check children
          return false; // Don't ignore containers, but we'll check children
        }
        return true;
      }
    }
    
    return false;
  }
  
  // Check if a node or its ancestors should be ignored
  function shouldIgnoreMutation(target) {
    if (!target) {
      return false;
    }
    
    // Quick check: if target is the widget itself
    if (target.id === 'performance-tracker-widget') {
      return true;
    }
    
    // Check if target or any ancestor is the extension widget
    let current = target;
    let depth = 0;
    const maxDepth = 15; // Check up the DOM tree
    
    while (current && depth < maxDepth) {
      // Check if it's the extension widget itself (by ID)
      if (current.id === 'performance-tracker-widget') {
        return true;
      }
      
      // Check if it's inside the extension widget by checking for widget-specific IDs
      const widgetIds = [
        'performance-tracker-widget',
        'mode-indicator',
        'mode-badge',
        'nav-count',
        'mode-toggle',
        'toggle-widget',
        'widget-content',
        'toggle-timeline',
        'timeline-container',
        'timeline-chart',
        'timeline-legend',
        'ttfb', 'first-paint', 'fcp', 'dom-ready', 'lcp', 'load-complete', 'tti', 'tbt', 'cls', 'last-pixel-change',
        'change-history-container', 'change-history-list', 'stable-indicator', 'clear-history', 'toggle-history',
        'lcp-history-container', 'lcp-history-list', 'lcp-count', 'toggle-lcp-history',
        'perf-tracker-highlight', 'perf-tracker-lcp-highlight'
      ];
      
      if (current.id && widgetIds.includes(current.id)) {
        return true;
      }
      
      // Check for widget-specific class patterns
      if (current.className && typeof current.className === 'string') {
        const className = current.className;
        if (className.includes('widget-header') ||
            className.includes('widget-content') ||
            className.includes('timeline-section') ||
            className.includes('timeline-chart') ||
            className.includes('metric-color-indicator') ||
            className.includes('mode-badge') ||
            className.includes('mode-indicator') ||
            className.includes('change-history') ||
            className.includes('stable-indicator') ||
            className.includes('lcp-history') ||
            className.includes('lcp-item') ||
            className.includes('lcp-badge')) {
          return true;
        }
      }
      
      if (shouldIgnoreElement(current)) {
        return true;
      }
      current = current.parentElement;
      depth++;
    }
    
    return false;
  }
  
  // Check if an element is actually visible to the user
  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    
    try {
      // Ignore extension widget
      if (element.id === 'performance-tracker-widget') {
        return false;
      }
      
      // Check if element is inside the extension widget
      let current = element;
      let depth = 0;
      const widgetIds = [
        'performance-tracker-widget',
        'mode-indicator', 'mode-badge', 'nav-count',
        'mode-toggle', 'toggle-widget', 'widget-content',
        'toggle-timeline', 'timeline-container', 'timeline-chart'
      ];
      
      while (current && depth < 15) {
        // Check by ID
        if (current.id && widgetIds.includes(current.id)) {
          return false;
        }
        
        // Check by class name patterns
        if (current.className && typeof current.className === 'string') {
          const className = current.className;
          if (className.includes('widget-header') ||
              className.includes('widget-content') ||
              className.includes('timeline-section') ||
              className.includes('timeline-chart') ||
              className.includes('metric-color-indicator') ||
              className.includes('mode-badge') ||
              className.includes('mode-indicator')) {
            return false;
          }
        }
        
        current = current.parentElement;
        depth++;
      }
      
      const tagName = element.tagName ? element.tagName.toLowerCase() : '';
      
      // Ignore non-visible elements
      const hiddenTags = ['script', 'style', 'meta', 'link', 'noscript', 'template', 'head'];
      if (hiddenTags.includes(tagName)) {
        return false;
      }
      
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);
      
      // Check if element has no dimensions
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }
      
      // Check if element is hidden
      if (computedStyle.display === 'none' || 
          computedStyle.visibility === 'hidden' || 
          computedStyle.opacity === '0') {
        return false;
      }
      
      // Check if element is outside viewport (with some margin for partial visibility)
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      
      // Element is visible if any part is in the viewport
      const isInViewport = !(rect.right < 0 || 
                            rect.left > viewportWidth || 
                            rect.bottom < 0 || 
                            rect.top > viewportHeight);
      
      if (!isInViewport) {
        return false;
      }
      
      // Check if element is clipped by overflow
      if (computedStyle.overflow === 'hidden') {
        // Check if element is within its parent's bounds
        const parent = element.parentElement;
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          if (rect.left < parentRect.left || 
              rect.right > parentRect.right || 
              rect.top < parentRect.top || 
              rect.bottom > parentRect.bottom) {
            // Might be clipped, but still check if any part is visible
            const hasVisiblePart = !(rect.right < parentRect.left || 
                                    rect.left > parentRect.right || 
                                    rect.bottom < parentRect.top || 
                                    rect.top > parentRect.bottom);
            if (!hasVisiblePart) {
              return false;
            }
          }
        }
      }
      
      return true;
    } catch (e) {
      // If we can't determine visibility, assume it's not visible to be safe
      return false;
    }
  }
  
  // Check if a mutation actually causes a visible change
  function isVisibleMutation(mutation) {
    // Check the target element
    if (!isElementVisible(mutation.target)) {
      return false;
    }
    
    // For added nodes, check if they're visible
    if (mutation.addedNodes.length > 0) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (isElementVisible(node)) {
            return true;
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          // Text nodes - check if parent is visible
          const parent = node.parentElement;
          if (parent && isElementVisible(parent)) {
            // Check if text is not empty
            if (node.textContent && node.textContent.trim().length > 0) {
              return true;
            }
          }
        }
      }
      return false;
    }
    
    // For removed nodes, check if the removal is visible
    if (mutation.removedNodes.length > 0) {
      // If we removed visible content, that's a visual change
      for (let i = 0; i < mutation.removedNodes.length; i++) {
        const node = mutation.removedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if it was visible before removal (we can't check now, so assume it was)
          const parent = mutation.target;
          if (parent && isElementVisible(parent)) {
            return true;
          }
        }
      }
    }
    
    // For attribute changes, check if they affect visible appearance
    if (mutation.type === 'attributes') {
      const attrName = mutation.attributeName;
      // Only count attributes that affect visual appearance
      if (attrName === 'style' || attrName === 'class') {
        // Check if the change affects visibility
        const computedStyle = window.getComputedStyle(mutation.target);
        // If element becomes visible or changes visible properties, it's a visual change
        if (computedStyle.display !== 'none' && 
            computedStyle.visibility !== 'hidden' && 
            computedStyle.opacity !== '0') {
          return true;
        }
      } else if (attrName === 'src' || attrName === 'width' || attrName === 'height') {
        // These can affect visible appearance
        return true;
      }
    }
    
    // For character data changes, check if parent is visible
    if (mutation.type === 'characterData') {
      const parent = mutation.target.parentElement;
      if (parent && isElementVisible(parent)) {
        return true;
      }
    }
    
    return false;
  }

  // Track last pixel change (when page stops visually changing)
  function trackLastPixelChange(isNavigation = false) {
    const INACTIVITY_THRESHOLD = 300; // Increased threshold to 300ms
    let lastChangeTime = performance.now();
    let debounceTimer = null;
    let pixelChangeObserver = null;
    let rafScheduled = false;
    let pendingMutations = [];
    const navStart = isNavigation ? navigationStartTime : null;
    
    const updateLastPixelChange = () => {
      let timeSinceStart;
      if (isNavigation && navStart) {
        // For navigation, calculate time since navigation started
        timeSinceStart = performance.now() - navStart;
      } else {
        // For page load, performance.now() is already relative to navigation start
        timeSinceStart = performance.now();
      }
      updateMetric('last-pixel-change', timeSinceStart, isNavigation);
    };
    
    // Check if mutations actually result in visible changes using RAF
    const checkVisibleChanges = () => {
      rafScheduled = false;
      let hasRealVisibleChange = false;
      const visibleChanges = []; // Track all visible changes for history
      const absoluteNow = performance.now();
      // Calculate time relative to start (navigation start or page load)
      const now = isNavigation && navStart ? absoluteNow - navStart : absoluteNow;

      // Don't track changes after 8 seconds
      if (now > MAX_METRIC_DURATION) {
        pendingMutations = [];
        return;
      }

      for (const mutation of pendingMutations) {
        // Skip mutations from ignored elements
        if (shouldIgnoreMutation(mutation.target)) {
          continue;
        }

        // More strict check - element must be visible AND in viewport
        const target = mutation.target;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }

        // Check if element is actually visible and rendering
        if (!isElementVisible(target)) {
          continue;
        }

        // For attribute changes, verify they actually affect rendering
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          // Only count attributes that definitely affect visual appearance
          if (attrName === 'src' || attrName === 'width' || attrName === 'height') {
            hasRealVisibleChange = true;
            visibleChanges.push({ element: target, type: 'style' });
          } else if (attrName === 'style' || attrName === 'class') {
            const rect = target.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(target);
            if (rect.width > 0 && rect.height > 0 &&
                computedStyle.display !== 'none' &&
                computedStyle.visibility !== 'hidden' &&
                computedStyle.opacity !== '0') {
              hasRealVisibleChange = true;
              visibleChanges.push({ element: target, type: 'style' });
            }
          }
        } else if (mutation.type === 'childList') {
          // For added nodes
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            // Skip plugin's own elements
            if (node.nodeType === Node.ELEMENT_NODE && shouldIgnoreMutation(node)) {
              continue;
            }
            if (node.nodeType === Node.ELEMENT_NODE && isElementVisible(node)) {
              hasRealVisibleChange = true;
              visibleChanges.push({ element: node, type: 'added' });
            } else if (node.nodeType === Node.TEXT_NODE) {
              const parent = node.parentElement;
              if (parent && isElementVisible(parent) && node.textContent.trim().length > 0) {
                hasRealVisibleChange = true;
                visibleChanges.push({ element: parent, type: 'text' });
              }
            }
          }
          // For removed nodes
          for (let i = 0; i < mutation.removedNodes.length; i++) {
            const node = mutation.removedNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE) {
              hasRealVisibleChange = true;
              visibleChanges.push({ element: mutation.target, type: 'removed' });
            }
          }
        } else if (mutation.type === 'characterData') {
          const parent = target.parentElement;
          if (parent && isElementVisible(parent) && target.textContent.trim().length > 0) {
            hasRealVisibleChange = true;
            visibleChanges.push({ element: parent, type: 'text' });
          }
        }
      }

      // Record visible changes to history (limit to avoid flooding)
      const uniqueChanges = new Map();
      visibleChanges.forEach(change => {
        const key = getElementSelector(change.element) + change.type;
        if (!uniqueChanges.has(key)) {
          uniqueChanges.set(key, change);
        }
      });

      // Record up to 5 unique changes per batch
      let recorded = 0;
      uniqueChanges.forEach(change => {
        if (recorded < 5) {
          recordVisualChange(change.element, change.type, now);
          recorded++;
        }
      });

      // Clear pending mutations
      pendingMutations = [];
      
      if (hasRealVisibleChange) {
        lastChangeTime = performance.now();
        
        // Clear existing timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        
        // Set new timer - if no mutations for INACTIVITY_THRESHOLD, consider stable
        debounceTimer = setTimeout(() => {
          const timeSinceLastChange = performance.now() - lastChangeTime;
          if (timeSinceLastChange >= INACTIVITY_THRESHOLD - 10) {
            updateLastPixelChange();
          }
        }, INACTIVITY_THRESHOLD);
      }
    };
    
    // Observe DOM mutations - batch them using requestAnimationFrame
    pixelChangeObserver = new MutationObserver((mutations) => {
      // Add mutations to pending list
      pendingMutations.push(...mutations);
      
      // Schedule RAF check if not already scheduled
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(checkVisibleChanges); // Double RAF for better accuracy
        });
      }
    });
    
    // Observe the entire document for changes
    pixelChangeObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'src', 'width', 'height', 'display'],
      characterData: true
    });
    
    // Also listen for image loads and other resource loads (but ignore GIFs)
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      // Skip GIF images and non-visible images
      if (shouldIgnoreElement(img) || !isElementVisible(img)) {
        return;
      }
      if (!img.complete) {
        img.addEventListener('load', () => {
          // Only count if image is still visible after load
          if (isElementVisible(img)) {
            pendingMutations.push({
              type: 'attributes',
              attributeName: 'src',
              target: img
            });
            if (!rafScheduled) {
              rafScheduled = true;
              requestAnimationFrame(() => {
                requestAnimationFrame(checkVisibleChanges);
              });
            }
          }
        }, { once: true });
      }
    });
    
    // Listen for window resize (can cause visual changes) - but be more strict
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      // Only count resize if it actually changes visible layout
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Check if any visible elements were affected
        const visibleElements = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        if (visibleElements.length > 0) {
          pendingMutations.push({
            type: 'attributes',
            attributeName: 'style',
            target: document.body
          });
          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
              requestAnimationFrame(checkVisibleChanges);
            });
          }
        }
      }, 100); // Debounce resize
    });
    
    // Stop tracking after a reasonable time (10 seconds for page load, 5 for navigation)
    const maxTrackingTime = isNavigation ? 5000 : 10000;
    const cleanup = () => {
      if (pixelChangeObserver) {
        pixelChangeObserver.disconnect();
      }
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      // Final update if not already set
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        updateLastPixelChange();
      }
    };
    setTimeout(cleanup, maxTrackingTime);
  }

  // Track initial page load
  function trackPageLoad() {
    // DOM Content Loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        const time = performance.now();
        updateMetric('dom-ready', time, false);
      });
    } else {
      const time = performance.now();
      updateMetric('dom-ready', time, false);
    }

    // Window Load
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => {
        const time = performance.now();
        updateMetric('load-complete', time, false);
        updateNavigationTiming();
        setTimeout(() => calculateTTI(), 1000);
      });
    } else {
      const time = performance.now();
      updateMetric('load-complete', time, false);
      updateNavigationTiming();
      setTimeout(() => calculateTTI(), 1000);
    }

    // Use Performance API for navigation timing
    function updateNavigationTiming() {
      if (performance.getEntriesByType) {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
          // TTFB: Time from request start to first byte received
          const ttfb = navigation.responseStart - navigation.requestStart;
          updateMetric('ttfb', ttfb, false);

          const fp = navigation.domContentLoadedEventEnd - navigation.fetchStart;
          updateMetric('first-paint', fp, false);

          if (!pageLoadMetrics['dom-ready']) {
            const domReady = navigation.domContentLoadedEventEnd - navigation.fetchStart;
            updateMetric('dom-ready', domReady, false);
          }

          if (!pageLoadMetrics['load-complete']) {
            const loadComplete = navigation.loadEventEnd - navigation.fetchStart;
            updateMetric('load-complete', loadComplete, false);
          }
        }
      }
    }

    function calculateTTI() {
      if (performance.getEntriesByType) {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
          const domContentLoaded = navigation.domContentLoadedEventEnd - navigation.fetchStart;
          const tti = domContentLoaded + 5000;
          updateMetric('tti', tti, false);
        }
      }
    }
    
    // Start tracking last pixel change for page load
    trackLastPixelChange(false);
  }

  // Track soft navigation
  function trackSoftNavigation() {
    console.log('[Performance Tracker] Soft navigation detected!', location.href);
    navigationCount++;
    navigationStartTime = performance.now();
    isTrackingNavigation = true;
    
    // Reset navigation metrics
    navigationMetrics = {
      'ttfb': null,
      'dom-ready': null,
      'load-complete': null,
      'first-paint': null,
      'fcp': null,
      'lcp': null,
      'tti': null,
      'tbt': null,
      'cls': null,
      'inp': null,
      'dom-size': null,
      'last-pixel-change': null
    };

    // Reset global tracking variables for navigation
    clsValue = 0;
    longTasks = [];
    worstInp = 0;

    // Update display if in navigation mode
    if (currentMode === 'navigation') {
      updateModeDisplay();
      displayMetrics();
    }

    // Update DOM size after navigation settles
    setTimeout(() => {
      updateDomSize(true);
      displayMetrics();
    }, 500);
    
    // Reinitialize observers for navigation
    initPerformanceObservers(true);
    
    // Track navigation-specific metrics
    const navStart = navigationStartTime;
    
    // Track DOM ready state (shared with MutationObserver)
    let domReadyTracked = false;
    let loadCompleteTracked = false;
    
    // Use requestAnimationFrame for immediate DOM ready tracking
    const trackDOMReady = () => {
      if (!domReadyTracked) {
        requestAnimationFrame(() => {
          const domReady = performance.now() - navStart;
          updateMetric('dom-ready', domReady, true);
          domReadyTracked = true;
        });
      }
    };
    
    // Track DOM ready immediately and on next frame
    trackDOMReady();
    
    // Track when navigation content is loaded (optimized for SPAs)
    const trackLoadComplete = () => {
      if (!loadCompleteTracked) {
        const loadComplete = performance.now() - navStart;
        updateMetric('load-complete', loadComplete, true);
        
        // First paint approximation (immediate, no delay)
        updateMetric('first-paint', loadComplete * 0.8, true);
        
        // TTI approximation (reduced delay)
        setTimeout(() => {
          const tti = loadComplete + 300; // Reduced from 500ms to 300ms
          updateMetric('tti', tti, true);
        }, 300);
        
        loadCompleteTracked = true;
      }
    };
    
    // For SPAs, check immediately if readyState is already complete
    if (document.readyState === 'complete') {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        requestAnimationFrame(trackLoadComplete);
      });
    } else {
      // Listen for load event (faster than polling)
      window.addEventListener('load', trackLoadComplete, { once: true });
      // Fallback: check after a short delay
      setTimeout(() => {
        if (!loadCompleteTracked && document.readyState === 'complete') {
          trackLoadComplete();
        }
      }, 50);
    }
    
    // Use MutationObserver to detect when navigation content is rendered
    let firstContentSeen = false;
    let largestContentSeen = false;
    const observer = new MutationObserver((mutations) => {
      const now = performance.now();
      const timeSinceNav = now - navStart;
      
      // Update DOM ready when we see changes (immediate, no delay)
      if (!domReadyTracked || !navigationMetrics['dom-ready'] || navigationMetrics['dom-ready'] > timeSinceNav) {
        updateMetric('dom-ready', timeSinceNav, true);
        domReadyTracked = true;
      }
      
      // Detect first contentful paint (first text or image node added) - immediate
      if (!firstContentSeen) {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              firstContentSeen = true;
              updateMetric('fcp', timeSinceNav, true);
              break;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if it's an image or has text content
              if (node.tagName === 'IMG' || node.textContent.trim()) {
                firstContentSeen = true;
                updateMetric('fcp', timeSinceNav, true);
                break;
              }
            }
          }
          if (firstContentSeen) break;
        }
      }
      
      // Detect largest contentful paint (reduced delay from 100ms to 50ms)
      if (!largestContentSeen && timeSinceNav > 50) {
        // Use requestAnimationFrame for better timing
        requestAnimationFrame(() => {
          if (!largestContentSeen) {
            const largeElements = document.querySelectorAll('img, video, div[style*="background"], h1, h2');
            if (largeElements.length > 0) {
              const lcpTime = performance.now() - navStart;
              largestContentSeen = true;
              updateMetric('lcp', lcpTime, true);
            }
          }
        });
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'src']
    });
    
    // Also check for images loading
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', () => {
          if (!largestContentSeen && navigationStartTime === navStart) {
            const timeSinceNav = performance.now() - navStart;
            largestContentSeen = true;
            updateMetric('lcp', timeSinceNav, true);
          }
        });
      }
    });
    
    // Stop observing after a reasonable time
    setTimeout(() => {
      observer.disconnect();
      isTrackingNavigation = false;
    }, 10000);
    
    // Start tracking last pixel change for navigation
    trackLastPixelChange(true);
  }

  // Detect soft navigations
  function detectSoftNavigations() {
    let lastUrl = location.href;
    let lastPath = location.pathname + location.search;
    
    // Intercept pushState and replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      // Only track if URL actually changed
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        lastPath = location.pathname + location.search;
        trackSoftNavigation();
      }
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      // Only track if URL actually changed
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        lastPath = location.pathname + location.search;
        trackSoftNavigation();
      }
    };
    
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      const newUrl = location.href;
      if (newUrl !== lastUrl && !isTrackingNavigation) {
        lastUrl = newUrl;
        lastPath = location.pathname + location.search;
        trackSoftNavigation();
      }
    });
    
    // Detect URL changes via hash changes (for hash-based routing)
    // Also detect pathname/search changes that might not trigger pushState
    setInterval(() => {
      const currentUrl = location.href;
      const currentPath = location.pathname + location.search;
      
      if (currentUrl !== lastUrl && !isTrackingNavigation) {
        // Check if it's a hash change (not a full page reload)
        const isHashChange = location.hash && currentUrl.split('#')[0] === lastUrl.split('#')[0];
        // Check if pathname/search changed (some routers might not use pushState)
        const isPathChange = currentPath !== lastPath;
        
        if (isHashChange || isPathChange) {
          lastUrl = currentUrl;
          lastPath = currentPath;
          trackSoftNavigation();
        }
      }
    }, 100);
  }

  // Initialize
  // Track DOM size (total element count)
  function updateDomSize(isNavigation = false) {
    // Count all elements excluding our widget
    const allElements = document.getElementsByTagName('*');
    let count = allElements.length;

    // Subtract our widget elements (approximate)
    const widget = document.getElementById('performance-tracker-widget');
    if (widget) {
      count -= widget.getElementsByTagName('*').length + 1;
    }

    updateMetric('dom-size', count, isNavigation);
  }

  // Resource Timing / Network tracking functions
  let waterfallOverlay = null;
  let waterfallSortMode = 'time'; // 'time' or 'size'

  function getResourceData() {
    const resources = performance.getEntriesByType('resource');
    const categorized = {
      doc: { count: 0, decodedSize: 0, transferSize: 0, items: [] },
      js: { count: 0, decodedSize: 0, transferSize: 0, items: [] },
      css: { count: 0, decodedSize: 0, transferSize: 0, items: [] },
      img: { count: 0, decodedSize: 0, transferSize: 0, items: [] },
      font: { count: 0, decodedSize: 0, transferSize: 0, items: [] },
      other: { count: 0, decodedSize: 0, transferSize: 0, items: [] }
    };

    let totalDecodedSize = 0;
    let totalTransferSize = 0;

    // Include the HTML document (navigation entry)
    const navigationEntries = performance.getEntriesByType('navigation');
    if (navigationEntries.length > 0) {
      const nav = navigationEntries[0];
      const docDecodedSize = nav.decodedBodySize || 0;
      const docTransferSize = nav.transferSize || 0;

      totalDecodedSize += docDecodedSize;
      totalTransferSize += docTransferSize;

      categorized.doc.count = 1;
      categorized.doc.decodedSize = docDecodedSize;
      categorized.doc.transferSize = docTransferSize;
      categorized.doc.items.push({
        url: nav.name || window.location.href,
        name: '(document)',
        decodedSize: docDecodedSize,
        transferSize: docTransferSize,
        startTime: 0,
        duration: nav.responseEnd || 0,
        initiatorType: 'navigation'
      });
    }

    resources.forEach(resource => {
      const url = resource.name;
      const decodedSize = resource.decodedBodySize || 0;
      const transferSize = resource.transferSize || 0;

      totalDecodedSize += decodedSize;
      totalTransferSize += transferSize;

      const item = {
        url: url,
        name: url.split('/').pop().split('?')[0] || url,
        decodedSize: decodedSize,
        transferSize: transferSize,
        startTime: resource.startTime,
        duration: resource.duration,
        initiatorType: resource.initiatorType
      };

      // Categorize by type
      if (resource.initiatorType === 'script' || url.match(/\.js(\?|$)/i)) {
        categorized.js.count++;
        categorized.js.decodedSize += decodedSize;
        categorized.js.transferSize += transferSize;
        categorized.js.items.push(item);
      } else if (resource.initiatorType === 'link' || resource.initiatorType === 'css' || url.match(/\.css(\?|$)/i)) {
        categorized.css.count++;
        categorized.css.decodedSize += decodedSize;
        categorized.css.transferSize += transferSize;
        categorized.css.items.push(item);
      } else if (resource.initiatorType === 'img' || url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)(\?|$)/i)) {
        categorized.img.count++;
        categorized.img.decodedSize += decodedSize;
        categorized.img.transferSize += transferSize;
        categorized.img.items.push(item);
      } else if (url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
        categorized.font.count++;
        categorized.font.decodedSize += decodedSize;
        categorized.font.transferSize += transferSize;
        categorized.font.items.push(item);
      } else {
        categorized.other.count++;
        categorized.other.decodedSize += decodedSize;
        categorized.other.transferSize += transferSize;
        categorized.other.items.push(item);
      }
    });

    return {
      total: resources.length + categorized.doc.count,
      totalDecodedSize,
      totalTransferSize,
      categorized,
      resources
    };
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  }

  // Get color class for total resource size
  // Thresholds: <2MB = good (green), <4MB = warning (orange), >=4MB = poor (red)
  function getResourceSizeColor(bytes) {
    const MB = 1024 * 1024;
    if (bytes < 2 * MB) return 'good';
    if (bytes < 4 * MB) return 'warning';
    return 'poor';
  }

  function updateResourcesSummary() {
    const summaryEl = document.getElementById('resources-summary');
    const countEl = document.getElementById('resources-count');
    if (!summaryEl) return;

    const data = getResourceData();

    // Update count badge
    if (countEl) {
      countEl.textContent = data.total;
    }

    const categories = [
      { key: 'doc', label: 'Doc', icon: '📄' },
      { key: 'js', label: 'JS', icon: '📜' },
      { key: 'css', label: 'CSS', icon: '🎨' },
      { key: 'img', label: 'Images', icon: '🖼️' },
      { key: 'font', label: 'Fonts', icon: '🔤' },
      { key: 'other', label: 'Other', icon: '📦' }
    ];

    let categoryHtml = '';
    categories.forEach((cat, index) => {
      const catData = data.categorized[cat.key];
      if (catData.count > 0) {
        const isLast = index === categories.length - 1 ||
          categories.slice(index + 1).every(c => data.categorized[c.key].count === 0);
        const prefix = isLast ? '└─' : '├─';
        categoryHtml += `
          <div class="resource-category-row">
            <span class="resource-tree-prefix">${prefix}</span>
            <span class="resource-category-label">${cat.label}:</span>
            <span class="resource-category-count">${catData.count}</span>
            <span class="resource-category-size">(${formatBytes(catData.decodedSize)} / ${formatBytes(catData.transferSize)})</span>
          </div>
        `;
      }
    });

    const sizeColorClass = getResourceSizeColor(data.totalDecodedSize);

    summaryEl.innerHTML = `
      <div class="resources-total-row">
        <span class="resources-total-count">${data.total} resources</span>
      </div>
      <div class="resources-size-row">
        <span class="resources-size-label">Size:</span>
        <span class="resources-size-value resources-size-${sizeColorClass}">${formatBytes(data.totalDecodedSize)}</span>
        <span class="resources-size-transferred">(${formatBytes(data.totalTransferSize)} transferred)</span>
      </div>
      <div class="resources-breakdown">
        ${categoryHtml}
      </div>
    `;
  }

  function showWaterfallOverlay() {
    // Remove existing overlay
    if (waterfallOverlay) {
      waterfallOverlay.remove();
      waterfallOverlay = null;
    }

    const data = getResourceData();
    let resources = [...data.resources];

    // Add the HTML document (navigation entry) as the first resource
    const navigationEntries = performance.getEntriesByType('navigation');
    if (navigationEntries.length > 0) {
      const nav = navigationEntries[0];
      resources.unshift({
        name: nav.name || window.location.href,
        initiatorType: 'navigation',
        startTime: 0,
        fetchStart: nav.fetchStart || 0,
        responseEnd: nav.responseEnd || nav.loadEventEnd || 0,
        duration: nav.responseEnd || nav.loadEventEnd || 0,
        decodedBodySize: nav.decodedBodySize || 0,
        transferSize: nav.transferSize || 0
      });
    }

    // Filter resources to only show those that started within the 8-second tracking window
    resources = resources.filter(r => (r.fetchStart || r.startTime) <= MAX_METRIC_DURATION);

    // Sort resources based on current sort mode
    if (waterfallSortMode === 'size') {
      // Sort by decoded size (largest first)
      resources.sort((a, b) => (b.decodedBodySize || 0) - (a.decodedBodySize || 0));
    } else if (waterfallSortMode === 'duration') {
      // Sort by duration (longest first)
      resources.sort((a, b) => {
        const durationA = (a.responseEnd || (a.startTime + a.duration)) - (a.fetchStart || a.startTime);
        const durationB = (b.responseEnd || (b.startTime + b.duration)) - (b.fetchStart || b.startTime);
        return durationB - durationA;
      });
    } else {
      // Sort by start time (fetchStart for more accuracy)
      resources.sort((a, b) => (a.fetchStart || a.startTime) - (b.fetchStart || b.startTime));
    }

    // Get the last pixel change time and LCP from the appropriate metrics object
    const metrics = currentMode === 'page-load' ? pageLoadMetrics : navigationMetrics;
    const lastPixelChangeTime = metrics['last-pixel-change'] || 0;
    const lcpTime = metrics['lcp'] || 0;

    // Use ceiling of Last Pixel Change (in seconds) as the end time for the waterfall chart
    // e.g., LPC = 3.1s → end time = 4s
    // Fall back to max resource end time if LPC not yet available
    const resourceMaxTime = Math.max(...resources.map(r => r.responseEnd || (r.startTime + r.duration)), 1);
    const lpcCeiling = Math.ceil(lastPixelChangeTime / 1000) * 1000; // Ceiling to nearest second
    const maxEndTime = lastPixelChangeTime > 0 ? lpcCeiling : Math.min(resourceMaxTime, MAX_METRIC_DURATION);

    waterfallOverlay = document.createElement('div');
    waterfallOverlay.id = 'perf-vibe-waterfall-overlay';
    waterfallOverlay.className = widget.classList.contains('dark-mode') ? 'dark-mode' : '';

    // Get all visual changes (within the extended time range)
    const visualChanges = changeHistory
      .filter(c => c.timestamp <= maxEndTime)
      .sort((a, b) => a.timestamp - b.timestamp);

    let resourceRows = '';
    resources.forEach((resource) => {
      // Use fetchStart for accurate start time, fallback to startTime
      const startTime = resource.fetchStart || resource.startTime;
      // Use responseEnd for accurate end time
      const endTime = resource.responseEnd || (resource.startTime + resource.duration);
      const actualDuration = endTime - startTime;

      const startPercent = (startTime / maxEndTime) * 100;
      const widthPercent = Math.max((actualDuration / maxEndTime) * 100, 0.5);
      const decodedSize = resource.decodedBodySize || 0;
      const transferSize = resource.transferSize || 0;

      // Determine type for color coding
      let typeClass = 'other';
      const url = resource.name;
      if (resource.initiatorType === 'navigation') {
        typeClass = 'doc';
      } else if (resource.initiatorType === 'script' || url.match(/\.js(\?|$)/i)) {
        typeClass = 'js';
      } else if (resource.initiatorType === 'link' || resource.initiatorType === 'css' || url.match(/\.css(\?|$)/i)) {
        typeClass = 'css';
      } else if (resource.initiatorType === 'img' || url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)(\?|$)/i)) {
        typeClass = 'img';
      } else if (url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
        typeClass = 'font';
      }

      let name;
      if (typeClass === 'doc') {
        // For document, show path or "Document" if just root
        try {
          const urlObj = new URL(url);
          name = urlObj.pathname === '/' ? '(document)' : urlObj.pathname;
        } catch (e) {
          name = '(document)';
        }
      } else {
        name = url.split('/').pop().split('?')[0] || url;
      }
      const truncatedName = name.length > 50 ? name.substring(0, 47) + '...' : name;

      // Extract domain/host from URL
      let domain = '';
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
      } catch (e) {
        domain = url.split('/')[2] || '';
      }
      const truncatedDomain = domain.length > 30 ? domain.substring(0, 27) + '...' : domain;

      // Show start time and duration in seconds
      const startTimeSeconds = (startTime / 1000).toFixed(2);
      const durationSeconds = (actualDuration / 1000).toFixed(2);

      // Generate visual change lines for this row
      const rowVisualLines = visualChanges.map(change => {
        const percent = (change.timestamp / maxEndTime) * 100;
        return `<div class="visual-change-line" style="left: ${percent}%"></div>`;
      }).join('');

      // Generate LPC line for this row (if available)
      const lpcLine = lastPixelChangeTime > 0 ? `<div class="lpc-line" style="left: ${(lastPixelChangeTime / maxEndTime) * 100}%"></div>` : '';

      // Generate LCP line for this row (if available)
      const lcpLine = lcpTime > 0 ? `<div class="lcp-line" style="left: ${(lcpTime / maxEndTime) * 100}%"></div>` : '';

      resourceRows += `
        <div class="waterfall-row" data-url="${escapeHtml(url)}">
          <div class="waterfall-name" title="${escapeHtml(name)}">${escapeHtml(truncatedName)}</div>
          <div class="waterfall-domain" title="${escapeHtml(domain)}">${escapeHtml(truncatedDomain)}</div>
          <div class="waterfall-size ${waterfallSortMode === 'size' ? 'sort-active' : ''}">${formatBytes(decodedSize)} / ${formatBytes(transferSize)}</div>
          <div class="waterfall-bar-container">
            ${rowVisualLines}
            ${lcpLine}
            ${lpcLine}
            <div class="waterfall-bar ${typeClass}" style="left: ${startPercent}%; width: ${widthPercent}%;" title="Start: ${startTimeSeconds}s, Duration: ${durationSeconds}s"></div>
          </div>
          <div class="waterfall-time ${waterfallSortMode === 'duration' ? 'sort-active' : ''}"><span class="waterfall-start">@${startTimeSeconds}s</span> ${durationSeconds}s</div>
        </div>
      `;
    });

    // Generate time scale markers with proper intervals (in seconds)
    const timeMarkers = [0, 0.25, 0.5, 0.75, 1].map(fraction => {
      const timeSeconds = (maxEndTime * fraction) / 1000;
      return `<span class="time-marker" style="left: ${fraction * 100}%">${timeSeconds.toFixed(1)}s</span>`;
    }).join('');

    // Generate visual change markers for the time scale
    const visualChangeMarkers = visualChanges.map(change => {
      const percent = (change.timestamp / maxEndTime) * 100;
      const timeSeconds = (change.timestamp / 1000).toFixed(2);
      return `<div class="visual-change-line" style="left: ${percent}%" title="Visual change at ${timeSeconds}s"></div>`;
    }).join('');

    // Generate LPC marker for the time scale
    const lpcMarker = lastPixelChangeTime > 0
      ? `<div class="lpc-line" style="left: ${(lastPixelChangeTime / maxEndTime) * 100}%" title="Last Pixel Change at ${(lastPixelChangeTime / 1000).toFixed(2)}s"></div>`
      : '';

    // Generate LCP marker for the time scale
    const lcpMarker = lcpTime > 0
      ? `<div class="lcp-line" style="left: ${(lcpTime / maxEndTime) * 100}%" title="Largest Contentful Paint at ${(lcpTime / 1000).toFixed(2)}s"></div>`
      : '';

    waterfallOverlay.innerHTML = `
      <div class="waterfall-panel">
        <div class="waterfall-header">
          <span class="waterfall-title">📊 Network Waterfall</span>
          <div class="waterfall-legend">
            <span class="legend-item doc">Doc</span>
            <span class="legend-item js">JS</span>
            <span class="legend-item css">CSS</span>
            <span class="legend-item img">Images</span>
            <span class="legend-item font">Fonts</span>
            <span class="legend-item other">Other</span>
            <span class="legend-item visual-change">👁 Visual</span>
            <span class="legend-item lcp">LCP</span>
            <span class="legend-item lpc">LPC</span>
          </div>
          <div class="waterfall-sort-controls">
            <button class="waterfall-sort-btn ${waterfallSortMode === 'size' ? 'active' : ''}" data-sort="size" title="Sort by Content Size">Sort by Content Size</button>
            <button class="waterfall-sort-btn ${waterfallSortMode === 'duration' ? 'active' : ''}" data-sort="duration" title="Sort by Duration">Sort by Duration</button>
            <button class="waterfall-sort-btn ${waterfallSortMode === 'time' ? 'active' : ''}" data-sort="time" title="Reset to Timeline">Reset</button>
          </div>
          <button class="waterfall-close-btn" title="Close">✕</button>
        </div>
        <div class="waterfall-scale-row">
          <div class="waterfall-scale-label">Resource</div>
          <div class="waterfall-scale-label">Domain</div>
          <div class="waterfall-scale-label ${waterfallSortMode === 'size' ? 'sort-active' : ''}">Content / Transferred Size <span class="size-info-icon">ⓘ</span><div class="size-info-tooltip">Cross-origin resources may show 0B due to browser security restrictions. The server must include the <strong>Timing-Allow-Origin</strong> header for accurate sizes.</div></div>
          <div class="waterfall-time-scale">
            ${timeMarkers}
            ${visualChangeMarkers}
            ${lcpMarker}
            ${lpcMarker}
          </div>
          <div class="waterfall-scale-label ${waterfallSortMode === 'duration' ? 'sort-active' : ''}">Start Time/Duration</div>
        </div>
        <div class="waterfall-content">
          ${resourceRows || '<div class="waterfall-empty">No resources loaded yet</div>'}
        </div>
        <div class="waterfall-footer">
          <span>Total: ${data.total} resources</span>
          <span>Size: ${formatBytes(data.totalDecodedSize)} (${formatBytes(data.totalTransferSize)} transferred)</span>
        </div>
      </div>
    `;

    document.body.appendChild(waterfallOverlay);

    // Close button event
    const closeBtn = waterfallOverlay.querySelector('.waterfall-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (waterfallOverlay) {
          waterfallOverlay.remove();
          waterfallOverlay = null;
        }
      });
    }

    // Sort button events
    const sortBtns = waterfallOverlay.querySelectorAll('.waterfall-sort-btn');
    sortBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const newSortMode = btn.dataset.sort;
        if (newSortMode !== waterfallSortMode) {
          waterfallSortMode = newSortMode;
          // Re-render the waterfall chart with new sort mode
          if (waterfallOverlay) {
            waterfallOverlay.remove();
            waterfallOverlay = null;
          }
          showWaterfallOverlay();
        }
      });
    });

    // Click outside to close
    waterfallOverlay.addEventListener('click', (e) => {
      if (e.target === waterfallOverlay) {
        waterfallOverlay.remove();
        waterfallOverlay = null;
      }
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Resource tracking state
  let resourceObserver = null;
  let resourceTrackingActive = true;

  // Start resource tracking - stops after 8 seconds (MAX_METRIC_DURATION)
  function startResourceTracking() {
    // Initial update after a short delay
    setTimeout(updateResourcesSummary, 500);

    // Update when new resources are loaded (observe PerformanceObserver)
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        resourceObserver = new PerformanceObserver(() => {
          if (resourceTrackingActive) {
            updateResourcesSummary();
          }
        });
        resourceObserver.observe({ entryTypes: ['resource'] });
      } catch (e) {
        // Fallback: update periodically until 8 seconds
        const intervalId = setInterval(() => {
          if (resourceTrackingActive) {
            updateResourcesSummary();
          }
        }, 1000);
        setTimeout(() => clearInterval(intervalId), MAX_METRIC_DURATION);
      }
    } else {
      // Fallback: update periodically until 8 seconds
      const intervalId = setInterval(() => {
        if (resourceTrackingActive) {
          updateResourcesSummary();
        }
      }, 1000);
      setTimeout(() => clearInterval(intervalId), MAX_METRIC_DURATION);
    }

    // Stop resource tracking after 8 seconds (consistent with MAX_METRIC_DURATION)
    setTimeout(() => {
      resourceTrackingActive = false;
      if (resourceObserver) {
        resourceObserver.disconnect();
      }
      // Final update
      updateResourcesSummary();

      // Enable the View Waterfall button now that collection is complete
      const waterfallBtn = widget.querySelector('#view-waterfall');
      if (waterfallBtn) {
        waterfallBtn.disabled = false;
        waterfallBtn.textContent = 'View Waterfall';
      }
    }, MAX_METRIC_DURATION);
  }

  // Heatmap visualization functions
  function createHeatmapOverlay() {
    // Remove existing overlay if any
    if (heatmapOverlay) {
      heatmapOverlay.remove();
      heatmapOverlay = null;
    }

    const GRID_SIZE = 20; // 20x20 grid cells
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cellWidth = viewportWidth / GRID_SIZE;
    const cellHeight = viewportHeight / GRID_SIZE;

    // Create overlay container
    heatmapOverlay = document.createElement('div');
    heatmapOverlay.id = 'perf-vibe-heatmap-overlay';
    heatmapOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483644;
      display: grid;
      grid-template-columns: repeat(${GRID_SIZE}, 1fr);
      grid-template-rows: repeat(${GRID_SIZE}, 1fr);
    `;

    // Calculate density for each grid cell
    const densityGrid = calculateContentDensity(GRID_SIZE, cellWidth, cellHeight);
    const maxDensity = Math.max(...densityGrid.flat(), 1);

    // Create grid cells with colors based on density
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const cell = document.createElement('div');
        const density = densityGrid[row][col];
        const normalizedDensity = density / maxDensity;
        const color = getHeatmapColor(normalizedDensity);

        cell.style.cssText = `
          background: ${color};
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: opacity 0.3s;
        `;
        cell.title = `Elements: ${density}`;
        heatmapOverlay.appendChild(cell);
      }
    }

    // Add legend
    const legend = document.createElement('div');
    legend.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      padding: 8px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      color: white;
      pointer-events: auto;
    `;
    legend.innerHTML = `
      <span>Less content</span>
      <div style="display: flex; height: 12px; width: 120px; border-radius: 3px; overflow: hidden;">
        <div style="flex: 1; background: rgba(59, 130, 246, 0.5);"></div>
        <div style="flex: 1; background: rgba(16, 185, 129, 0.5);"></div>
        <div style="flex: 1; background: rgba(245, 158, 11, 0.5);"></div>
        <div style="flex: 1; background: rgba(239, 68, 68, 0.5);"></div>
      </div>
      <span>More content</span>
      <button id="close-heatmap" style="margin-left: 12px; background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;">Close</button>
    `;
    heatmapOverlay.appendChild(legend);

    document.body.appendChild(heatmapOverlay);

    // Add close button handler
    document.getElementById('close-heatmap').addEventListener('click', toggleHeatmap);
  }

  function calculateContentDensity(gridSize, cellWidth, cellHeight) {
    const densityGrid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));
    const widget = document.getElementById('performance-tracker-widget');
    const heatmap = document.getElementById('perf-vibe-heatmap-overlay');

    // Get all visible elements
    const allElements = document.body.getElementsByTagName('*');

    for (const element of allElements) {
      // Skip our widget and heatmap elements
      if (widget && widget.contains(element)) continue;
      if (heatmap && heatmap.contains(element)) continue;
      if (element.id === 'performance-tracker-widget') continue;
      if (element.id === 'perf-vibe-heatmap-overlay') continue;

      // Skip hidden elements
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const rect = element.getBoundingClientRect();

      // Skip elements outside viewport or with no size
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.right < 0 || rect.left > window.innerWidth) continue;

      // Calculate which grid cells this element overlaps
      const startCol = Math.max(0, Math.floor(rect.left / cellWidth));
      const endCol = Math.min(gridSize - 1, Math.floor(rect.right / cellWidth));
      const startRow = Math.max(0, Math.floor(rect.top / cellHeight));
      const endRow = Math.min(gridSize - 1, Math.floor(rect.bottom / cellHeight));

      // Weight by element area (larger elements contribute more)
      const area = rect.width * rect.height;
      const weight = Math.min(1, area / (cellWidth * cellHeight * 4)) + 0.1;

      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          densityGrid[row][col] += weight;
        }
      }
    }

    return densityGrid;
  }

  function getHeatmapColor(normalizedValue) {
    // Color gradient: blue (low) -> green -> yellow -> red (high)
    if (normalizedValue < 0.25) {
      return `rgba(59, 130, 246, ${0.2 + normalizedValue * 1.2})`; // Blue
    } else if (normalizedValue < 0.5) {
      return `rgba(16, 185, 129, ${0.3 + normalizedValue * 0.8})`; // Green
    } else if (normalizedValue < 0.75) {
      return `rgba(245, 158, 11, ${0.4 + normalizedValue * 0.6})`; // Yellow/Orange
    } else {
      return `rgba(239, 68, 68, ${0.5 + normalizedValue * 0.4})`; // Red
    }
  }

  function toggleHeatmap() {
    if (isHeatmapVisible) {
      // Hide heatmap
      if (heatmapOverlay) {
        heatmapOverlay.remove();
        heatmapOverlay = null;
      }
      isHeatmapVisible = false;
      const btn = document.getElementById('heatmap-toggle');
      if (btn) btn.classList.remove('active');
    } else {
      // Show heatmap
      createHeatmapOverlay();
      isHeatmapVisible = true;
      const btn = document.getElementById('heatmap-toggle');
      if (btn) btn.classList.add('active');
    }
  }

  function initializeExtension() {
    injectWidget();
    initializeColorIndicators();
    trackPageLoad();
    initPerformanceObservers(false);
    initCustomMetricObserver();
    detectSoftNavigations();
    updateModeDisplay();
    startResourceTracking();
    // Display initial metrics and timeline
    setTimeout(() => {
      updateDomSize(false); // Initial DOM size measurement
      displayMetrics();
      renderTimeline();
    }, 100);
    // Update timeline again after metrics have time to populate
    setTimeout(() => {
      updateDomSize(false); // Update DOM size after page settles
      renderTimeline();
    }, 2000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initializeExtension();
  });

  // Fallback if DOMContentLoaded already fired
  if (document.readyState !== 'loading') {
    initializeExtension();
  }

})();
