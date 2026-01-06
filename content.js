// Create performance tracker widget with soft navigation support
(function() {
  'use strict';

  // State management
  let currentMode = 'page-load'; // 'page-load' or 'navigation'
  let navigationCount = 0;
  let navigationStartTime = null;
  let isTrackingNavigation = false;
  
  // Metrics storage
  let pageLoadMetrics = {
    'dom-ready': null,
    'load-complete': null,
    'first-paint': null,
    'fcp': null,
    'lcp': null,
    'tti': null,
    'tbt': null,
    'cls': null,
    'last-pixel-change': null
  };
  let navigationMetrics = {
    'dom-ready': null,
    'load-complete': null,
    'first-paint': null,
    'fcp': null,
    'lcp': null,
    'tti': null,
    'tbt': null,
    'cls': null,
    'last-pixel-change': null
  };
  
  // Performance observers
  let fcpObserver = null;
  let lcpObserver = null;
  let clsObserver = null;
  let longTaskObserver = null;
  let clsValue = 0;
  let longTasks = [];

  // Create the widget container
  const widget = document.createElement('div');
  widget.id = 'performance-tracker-widget';
  widget.innerHTML = `
    <div class="widget-header">
      <div class="header-left">
        <span>⚡ Performance</span>
        <div class="mode-indicator" id="mode-indicator">
          <span class="mode-badge" id="mode-badge">Page Load</span>
          <span class="nav-count" id="nav-count"></span>
        </div>
      </div>
      <div class="header-right">
        <button id="mode-toggle" class="mode-toggle-btn" title="Switch between Page Load and Navigation metrics">🔄</button>
        <button id="toggle-widget" class="toggle-btn">−</button>
      </div>
    </div>
    <div class="widget-content" id="widget-content">
      <div class="timeline-section">
        <div class="timeline-header">
          <span class="timeline-title">Loading Timeline</span>
          <button id="toggle-timeline" class="toggle-timeline-btn" title="Toggle timeline">▼</button>
        </div>
        <div class="timeline-container" id="timeline-container">
          <div class="timeline-chart" id="timeline-chart"></div>
        </div>
      </div>
      <div class="metrics-section">
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
          <span class="metric-label"><span class="metric-color-indicator" data-metric="last-pixel-change"></span>Last Pixel Change:</span>
          <span class="metric-value" id="last-pixel-change">-</span>
        </div>
      </div>
    </div>
  `;

  // Append to body when DOM is ready
  function injectWidget() {
    if (document.body) {
      document.body.appendChild(widget);
      setupEventListeners();
    } else {
      setTimeout(injectWidget, 10);
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
  }

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
    'first-paint': '#8b5cf6',
    'fcp': '#3b82f6',
    'dom-ready': '#10b981',
    'lcp': '#f59e0b',
    'load-complete': '#ef4444',
    'tti': '#6366f1',
    'tbt': '#ec4899',
    'cls': '#14b8a6',
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
    const metricKeys = ['first-paint', 'fcp', 'dom-ready', 'lcp', 'load-complete', 'tti', 'tbt', 'cls', 'last-pixel-change'];
    
    metricKeys.forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (metrics[key] !== null && metrics[key] !== undefined) {
          element.textContent = formatTime(metrics[key]);
          // Color code based on performance
          if (key === 'dom-ready' || key === 'load-complete') {
            element.className = 'metric-value ' + getPerformanceClass(metrics[key]);
          } else {
            element.className = 'metric-value';
          }
        } else {
          element.textContent = '-';
          element.className = 'metric-value';
        }
      }
    });
    
    // Update timeline when metrics change
    renderTimeline();
  }

  // Render timeline chart
  function renderTimeline() {
    const metrics = currentMode === 'page-load' ? pageLoadMetrics : navigationMetrics;
    const timelineChart = document.getElementById('timeline-chart');
    const timelineContainer = document.getElementById('timeline-container');
    
    if (!timelineChart) return;
    
    // Make sure timeline container is visible
    if (timelineContainer) {
      timelineContainer.style.display = 'block';
    }
    
    // Define timeline metrics (exclude TBT and CLS as they're not time-based)
    const timelineMetrics = [
      { key: 'first-paint', label: 'First Paint', color: '#8b5cf6', order: 1 },
      { key: 'fcp', label: 'FCP', color: '#3b82f6', order: 2 },
      { key: 'dom-ready', label: 'DOM Ready', color: '#10b981', order: 3 },
      { key: 'lcp', label: 'LCP', color: '#f59e0b', order: 4 },
      { key: 'load-complete', label: 'Load Complete', color: '#ef4444', order: 5 },
      { key: 'tti', label: 'TTI', color: '#6366f1', order: 6 },
      { key: 'last-pixel-change', label: 'Last Pixel Change', color: '#06b6d4', order: 7 }
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
      timelineChart.innerHTML = `<div class="timeline-empty">${emptyMessage}</div>`;
      return;
    }
    
    // Find the maximum time value for scaling
    const maxTime = Math.max(...availableMetrics.map(m => metrics[m.key]));
    // Add some padding (10%) to the max time for better visualization
    const paddedMaxTime = maxTime * 1.1;
    const timelineWidth = 280; // Width of timeline in pixels
    
    // Clear previous content
    timelineChart.innerHTML = '';
    
    // Create timeline axis
    const axis = document.createElement('div');
    axis.className = 'timeline-axis';
    timelineChart.appendChild(axis);
    
    // Create timeline bars for each metric
    availableMetrics.forEach((metric, index) => {
      const time = metrics[metric.key];
      const position = (time / paddedMaxTime) * timelineWidth;
      
      // Create timeline bar
      const bar = document.createElement('div');
      bar.className = 'timeline-bar';
      bar.style.left = `${position}px`;
      bar.style.backgroundColor = metric.color;
      bar.title = `${metric.label}: ${formatTime(time)}`;
      
      // Create marker
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      marker.style.backgroundColor = metric.color;
      marker.textContent = metric.label;
      
      // Create line
      const line = document.createElement('div');
      line.className = 'timeline-line';
      line.style.left = `${position}px`;
      line.style.backgroundColor = metric.color;
      
      bar.appendChild(marker);
      timelineChart.appendChild(bar);
      timelineChart.appendChild(line);
    });
    
    // Add time scale markers
    const scaleMarkers = [0, 25, 50, 75, 100].map(percent => {
      const time = (percent / 100) * paddedMaxTime;
      const marker = document.createElement('div');
      marker.className = 'timeline-scale-marker';
      marker.style.left = `${(percent / 100) * timelineWidth}px`;
      marker.textContent = formatTime(time);
      return marker;
    });
    
    const scaleContainer = document.createElement('div');
    scaleContainer.className = 'timeline-scale';
    scaleMarkers.forEach(m => scaleContainer.appendChild(m));
    timelineChart.appendChild(scaleContainer);
  }

  // Update metric
  function updateMetric(id, value, isNavigation = false) {
    const targetMetrics = isNavigation ? navigationMetrics : pageLoadMetrics;
    targetMetrics[id] = value;
    
    // Only update display if we're viewing the correct mode
    if ((isNavigation && currentMode === 'navigation') || 
        (!isNavigation && currentMode === 'page-load')) {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = formatTime(value);
        // Color code based on performance
        if (id === 'dom-ready' || id === 'load-complete') {
          element.className = 'metric-value ' + getPerformanceClass(value);
        } else {
          element.className = 'metric-value';
        }
      }
      // Update timeline when metrics change in the current mode
      renderTimeline();
    }
  }

  function formatTime(ms) {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) {
      return ms.toFixed(0) + 'ms';
    }
    return (ms / 1000).toFixed(2) + 's';
  }

  function getPerformanceClass(ms) {
    if (ms < 1000) return 'good';
    if (ms < 3000) return 'medium';
    return 'poor';
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

    } catch (e) {
      console.log('Some performance metrics not available:', e);
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
        'first-paint', 'fcp', 'dom-ready', 'lcp', 'load-complete', 'tti', 'tbt', 'cls', 'last-pixel-change'
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
            className.includes('mode-indicator')) {
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
            // These always affect visual appearance
            hasRealVisibleChange = true;
            break;
          } else if (attrName === 'style' || attrName === 'class') {
            // Double-check that the style change is visible
            const rect = target.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(target);
            // Only count if element is still visible after change
            if (rect.width > 0 && rect.height > 0 && 
                computedStyle.display !== 'none' && 
                computedStyle.visibility !== 'hidden' &&
                computedStyle.opacity !== '0') {
              hasRealVisibleChange = true;
              break;
            }
          }
        } else if (mutation.type === 'childList') {
          // For added/removed nodes, check if they're visible
          let hasVisibleNode = false;
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE && isElementVisible(node)) {
              hasVisibleNode = true;
              break;
            } else if (node.nodeType === Node.TEXT_NODE) {
              // Text node - check if parent is visible
              const parent = node.parentElement;
              if (parent && isElementVisible(parent) && node.textContent.trim().length > 0) {
                hasVisibleNode = true;
                break;
              }
            }
          }
          if (hasVisibleNode) {
            hasRealVisibleChange = true;
            break;
          }
        } else if (mutation.type === 'characterData') {
          // Text content change - check if parent is visible
          const parent = target.parentElement;
          if (parent && isElementVisible(parent) && target.textContent.trim().length > 0) {
            hasRealVisibleChange = true;
            break;
          }
        }
      }
      
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
      'dom-ready': null,
      'load-complete': null,
      'first-paint': null,
      'fcp': null,
      'lcp': null,
      'tti': null,
      'tbt': null,
      'cls': null
    };
    
    // Reset global tracking variables for navigation
    clsValue = 0;
    longTasks = [];
    
    // Update display if in navigation mode
    if (currentMode === 'navigation') {
      updateModeDisplay();
      displayMetrics();
    }
    
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
  function initializeExtension() {
    injectWidget();
    initializeColorIndicators();
    trackPageLoad();
    initPerformanceObservers(false);
    detectSoftNavigations();
    updateModeDisplay();
    // Display initial metrics and timeline
    setTimeout(() => {
      displayMetrics();
      renderTimeline();
    }, 100);
    // Update timeline again after metrics have time to populate
    setTimeout(() => {
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
