/* ============================================================
   ROUTEX TRANSIT — GLOBAL AOS (Animate On Scroll) SETUP
   Central point – no duplication in page-specific files
   ============================================================ */

// Initialise AOS library when the page loads
AOS.init({
    // Animation settings
    duration: 800,        // how long the animation lasts (ms)
    once: true,           // animate elements only once
    easing: 'ease-out-quad', // smooth modern easing

    // Optional: you can disable AOS on mobile if needed (keep it for now)
    // disable: 'mobile'
});



/* ============================================================
   GLOBAL NUMBER COUNT-UP ANIMATION
   Runs on any element with .stat-value (customise if needed)
   You can also trigger it manually: animateNumbers('.my-class')
   ============================================================ */

function animateNumbers(selector = '.stat-value', duration = 1200) {
    const elements = document.querySelectorAll(selector);

    elements.forEach(el => {
        // Avoid animating an element that's already being animated
        if (el.dataset.counting === 'true') return;

        const targetText = el.textContent.trim();
        const target = parseInt(targetText, 10);
        if (isNaN(target) || target <= 0) return;

        // Prepare for animation
        el.dataset.counting = 'true';
        const start = 0;
        const startTime = performance.now();

        function step(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1); // 0 → 1
            // Ease out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(start + (target - start) * eased);

            el.textContent = current;

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = target; // ensure exact final value
                el.dataset.counting = 'false';
            }
        }

        requestAnimationFrame(step);
    });
}

// Automatically animate numbers that are already on the page
// (Wait a short moment to let dynamic content load)
window.addEventListener('load', () => {
    setTimeout(() => animateNumbers('.stat-value'), 300);
});

// Optional: Observe future elements with IntersectionObserver
// so numbers animate when they scroll into view.
const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const el = entry.target;
            // Animate only if it's a .stat-value and hasn't been animated yet
            if (el.classList.contains('stat-value') && el.dataset.counting !== 'true') {
                animateNumbers('.stat-value');
            }
            // Stop observing after first animation (optional)
            // countObserver.unobserve(el);
        }
    });
}, { threshold: 0.5 });

// Start observing any existing .stat-value elements
document.querySelectorAll('.stat-value').forEach(el => countObserver.observe(el));