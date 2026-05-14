/**
 * greeting.js — Dynamic personalized greeting for MarkTrack
 * ──────────────────────────────────────────────────────────
 * Usage:
 *   renderGreeting('homeGreeting', 'Emmi');
 *
 * Or let it auto-read from window.__APP_USER_NAME__:
 *   renderGreeting('homeGreeting');
 */

(function (global) {
  'use strict';

  // ─── SVG icon sets (inline, no external dependency) ─────────────────────────
  const ICONS = {
    morning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1"  x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1"  y1="12" x2="3"  y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
        <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
      </svg>`,

    afternoon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M17 18a5 5 0 0 0-10 0"/>
        <line x1="12" y1="2"  x2="12" y2="9"/>
        <line x1="4.22"  y1="10.22" x2="5.64"  y2="11.64"/>
        <line x1="1"  y1="18" x2="3"  y2="18"/>
        <line x1="21" y1="18" x2="23" y2="18"/>
        <line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/>
      </svg>`,

    evening: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>`,

    night: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        <line x1="12" y1="1"  x2="12" y2="3"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>`,
  };

  // ─── Time-of-day buckets (hour ranges, 24h) ──────────────────────────────────
  //   Dawn     05–08
  //   Morning  08–12
  //   Afternoon 12–17
  //   Evening  17–21
  //   Night    21–05
  function _getPeriod(hour) {
    if (hour >= 5  && hour < 8)  return 'dawn';
    if (hour >= 8  && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  // ─── Phrase pools per period ─────────────────────────────────────────────────
  //   {name} is replaced at runtime; {icon} is injected as HTML.
  const PHRASES = {
    dawn: [
      { icon: 'morning', text: 'Early start today, {name}' },
      { icon: 'morning', text: 'Rise and shine, {name}' },
      { icon: 'morning', text: 'Up already, {name}? You\'re ahead of the game' },
      { icon: 'morning', text: 'Good morning, {name} — the world is still quiet' },
    ],
    morning: [
      { icon: 'morning', text: 'Good morning, {name}' },
      { icon: 'morning', text: 'Wishing you a productive morning, {name}' },
      { icon: 'morning', text: 'Morning, {name} — let\'s make it count' },
      { icon: 'morning', text: 'Ready to tackle the day, {name}?' },
      { icon: 'morning', text: 'Hey {name}, great things start with mornings like this' },
    ],
    afternoon: [
      { icon: 'afternoon', text: 'Good afternoon, {name}' },
      { icon: 'afternoon', text: 'Hope your afternoon is going well, {name}' },
      { icon: 'afternoon', text: 'Keeping up the momentum, {name}?' },
      { icon: 'afternoon', text: 'Still going strong, {name}' },
      { icon: 'afternoon', text: 'Great to see you this afternoon, {name}' },
    ],
    evening: [
      { icon: 'evening', text: 'Good evening, {name}' },
      { icon: 'evening', text: 'Hope you had a great day, {name}' },
      { icon: 'evening', text: 'Wrapping things up, {name}?' },
      { icon: 'evening', text: 'Evening, {name} — almost there' },
      { icon: 'evening', text: 'Nice work today, {name}' },
    ],
    night: [
      { icon: 'night', text: 'Good night, {name}' },
      { icon: 'night', text: 'Burning the midnight oil, {name}?' },
      { icon: 'night', text: 'Still at it, {name} — respect' },
      { icon: 'night', text: 'The night belongs to you, {name}' },
      { icon: 'night', text: 'Late-night session, {name}?' },
    ],
  };

  // ─── Icon accent colors by period ───────────────────────────────────────────
  const ICON_COLOR = {
    dawn:      '#f59e0b',  // amber
    morning:   '#fbbf24',  // yellow
    afternoon: '#fb923c',  // orange
    evening:   '#a78bfa',  // violet
    night:     '#818cf8',  // indigo
  };

  // ─── Pick a seeded-random item from an array (changes once per hour) ─────────
  function _pickPhrase(pool, hour) {
    // Deterministic within the same hour, random across hours
    const seed = hour * 31 + new Date().getDate() * 7;
    return pool[seed % pool.length];
  }

  // ─── Extract the first name from a full name or email ───────────────────────
  function _firstName(nameOrEmail) {
    if (!nameOrEmail || nameOrEmail === 'anonymous') return 'there';
    // If it looks like an email, take the part before @, then split on dots/underscores
    if (nameOrEmail.includes('@')) {
      nameOrEmail = nameOrEmail.split('@')[0].replace(/[._]/g, ' ');
    }
    const parts = nameOrEmail.trim().split(/\s+/);
    const first = parts[0] || 'there';
    // Capitalise first letter
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  // ─── Core builder ────────────────────────────────────────────────────────────
  /**
   * buildGreeting(name?, now?)
   * Returns an object { html, text, period, icon }
   *
   * @param {string}  [name]  - Display name or email. Falls back to window.__APP_USER_NAME__
   *                            → window.__APP_USER_EMAIL__ → 'there'
   * @param {Date}    [now]   - Override current date (useful for testing)
   */
  function buildGreeting(name, now) {
    now = now || new Date();
    const hour   = now.getHours();
    const period = _getPeriod(hour);
    const phrase = _pickPhrase(PHRASES[period], hour);

    // Resolve display name
    const resolved =
      name ||
      global.__APP_USER_NAME__ ||
      global.__APP_USER_EMAIL__ ||
      'there';
    const displayName = _firstName(resolved);

    const text     = phrase.text.replace('{name}', displayName);
    const iconSvg  = ICONS[phrase.icon] || '';
    const color    = ICON_COLOR[period];

    const html = `
      <span class="greeting-icon" aria-hidden="true"
            style="display:inline-flex;align-items:center;margin-right:10px;
                   color:${color};vertical-align:middle;
                   filter:drop-shadow(0 0 6px ${color}66);">
        ${iconSvg}
      </span>
      <span class="greeting-text">${text}</span>`;

    return { html, text, period, color };
  }

  // ─── Main public function ────────────────────────────────────────────────────
  /**
   * renderGreeting(elementId, name?)
   * Writes the greeting into the element and sets up an hourly refresh.
   *
   * @param {string}  elementId  - ID of the target <h1> (or any element)
   * @param {string}  [name]     - Optional display name or email
   */
  function renderGreeting(elementId, name) {
    const el = document.getElementById(elementId);
    if (!el) {
      console.warn('[greeting.js] Element not found:', elementId);
      return;
    }

    function _render() {
      const g = buildGreeting(name);
      el.innerHTML = g.html;

      // Subtle entrance animation (CSS keyframe-friendly)
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
      // Force reflow so the transition fires
      void el.offsetWidth;
      el.style.opacity = '';
      el.style.transform = '';
    }

    _render();

    // Refresh at the top of every hour
    function _scheduleHourlyRefresh() {
      const now  = new Date();
      const msUntilNextHour =
        (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000;
      setTimeout(function () {
        _render();
        _scheduleHourlyRefresh();  // reschedule for the next hour
      }, msUntilNextHour);
    }
    _scheduleHourlyRefresh();
  }

  // ─── Exports ─────────────────────────────────────────────────────────────────
  global.renderGreeting = renderGreeting;
  global.buildGreeting  = buildGreeting;   // exposed for testing

})(window);
