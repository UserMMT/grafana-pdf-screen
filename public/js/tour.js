(function () {
  'use strict';

  var overlay = null;
  var tooltip = null;
  var spotlight = null;
  var currentSteps = [];
  var currentIndex = 0;
  var resizeHandler = null;

  function seenKey(pageId) {
    return 'tour_seen_' + pageId;
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';

    spotlight = document.createElement('div');
    spotlight.className = 'tour-spotlight';
    overlay.appendChild(spotlight);

    tooltip = document.createElement('div');
    tooltip.className = 'tour-tooltip';
    tooltip.innerHTML =
      '<div class="tour-title"></div>' +
      '<div class="tour-text"></div>' +
      '<div class="tour-footer">' +
      '  <span class="tour-progress"></span>' +
      '  <div class="tour-buttons">' +
      '    <button type="button" class="btn small" data-tour-action="skip">Skip</button>' +
      '    <button type="button" class="btn small" data-tour-action="prev">Back</button>' +
      '    <button type="button" class="btn small primary" data-tour-action="next">Next</button>' +
      '  </div>' +
      '</div>';
    overlay.appendChild(tooltip);

    overlay.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-tour-action');
      if (action === 'skip') stop();
      else if (action === 'next') next();
      else if (action === 'prev') prev();
    });

    document.body.appendChild(overlay);
  }

  function placeStep() {
    var step = currentSteps[currentIndex];
    var el = step.selector ? document.querySelector(step.selector) : null;

    tooltip.querySelector('.tour-title').textContent = step.title || '';
    tooltip.querySelector('.tour-text').textContent = step.text || '';
    tooltip.querySelector('.tour-progress').textContent = (currentIndex + 1) + ' / ' + currentSteps.length;
    tooltip.querySelector('[data-tour-action="prev"]').style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
    tooltip.querySelector('[data-tour-action="next"]').textContent = currentIndex === currentSteps.length - 1 ? 'Done' : 'Next';

    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // give scrollIntoView a beat to finish before measuring position
      setTimeout(function () { position(el); }, 250);
    } else {
      spotlight.style.display = 'none';
      centerTooltip();
    }
  }

  function position(el) {
    var rect = el.getBoundingClientRect();
    var pad = 6;
    spotlight.style.display = 'block';
    spotlight.style.top = (rect.top - pad) + 'px';
    spotlight.style.left = (rect.left - pad) + 'px';
    spotlight.style.width = (rect.width + pad * 2) + 'px';
    spotlight.style.height = (rect.height + pad * 2) + 'px';

    var ttRect = tooltip.getBoundingClientRect();
    var top = rect.bottom + 14;
    if (top + ttRect.height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - ttRect.height - 14);
    }
    var left = Math.min(Math.max(10, rect.left), window.innerWidth - ttRect.width - 10);
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function centerTooltip() {
    var ttRect = tooltip.getBoundingClientRect();
    tooltip.style.top = ((window.innerHeight - ttRect.height) / 2) + 'px';
    tooltip.style.left = ((window.innerWidth - ttRect.width) / 2) + 'px';
  }

  function next() {
    if (currentIndex >= currentSteps.length - 1) {
      stop();
      return;
    }
    currentIndex++;
    placeStep();
  }

  function prev() {
    if (currentIndex === 0) return;
    currentIndex--;
    placeStep();
  }

  function stop() {
    if (overlay) overlay.classList.remove('tour-active');
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    document.body.classList.remove('tour-open');
  }

  function start(pageId, steps) {
    if (!steps || !steps.length) return;
    if (!overlay) build();
    currentSteps = steps;
    currentIndex = 0;
    overlay.classList.add('tour-active');
    document.body.classList.add('tour-open');
    resizeHandler = function () { placeStep(); };
    window.addEventListener('resize', resizeHandler);
    placeStep();
    if (pageId) localStorage.setItem(seenKey(pageId), '1');
  }

  function hasSeen(pageId) {
    return localStorage.getItem(seenKey(pageId)) === '1';
  }

  window.GrafanaReportsTour = { start: start, hasSeen: hasSeen };
})();
