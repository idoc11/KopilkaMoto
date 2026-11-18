// Анимации интерфейса. Все уважают системную настройку «уменьшить движение».

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export const reducedMotion = () => Boolean(media?.matches);

/** Длительности анимаций в мс. Держи в соответствии с переменными --t-* в styles.css. */
export const MOTION = {
  count: 1500, // досчитывание суммы
  drive: 1800, // «езда» мотоцикла (≈ --t-move)
  leave: 450, // уход удалённой записи (= --t-ui)
  stagger: 110, // задержка между столбцами графика
  markToast: 1900, // тост о новой отметке после её появления
};

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const running = new WeakMap();

/** Плавно меняет число в элементе от from до to. */
export function countUp(el, from, to, format, duration = MOTION.count) {
  cancelAnimationFrame(running.get(el));
  if (reducedMotion() || from === to || !Number.isFinite(from)) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(from + (to - from) * easeOutCubic(t));
    if (t < 1) running.set(el, requestAnimationFrame(step));
  };
  running.set(el, requestAnimationFrame(step));
}

/** Перезапускает CSS-анимацию класса cls на элементе. */
export function replay(el, cls, ms) {
  if (!el || reducedMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth; // принудительный reflow, чтобы анимация началась заново
  el.classList.add(cls);
  clearTimeout(el[`_${cls}Timer`]);
  if (ms) el[`_${cls}Timer`] = setTimeout(() => el.classList.remove(cls), ms);
}

/** Анимирует уход элемента, затем вызывает done. Без анимации — сразу. */
export function leave(el, done, ms = MOTION.leave) {
  if (!el || reducedMotion()) return done();
  el.classList.add('leaving');
  setTimeout(done, ms);
}

/** Короткая вибрация на Android как подтверждение действия. */
export function haptic(pattern = 12) {
  try {
    if (!reducedMotion()) navigator.vibrate?.(pattern);
  } catch {
    /* не поддерживается */
  }
}
