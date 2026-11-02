import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';

import { prefersReducedMotion } from '../../hooks/useNow';
import { markTourCompleted, type TourRoute, type TourStep } from './tourSteps';

interface StartOptions {
  /** Route key, used for the completion flag. */
  route: TourRoute;
  /** Element to return focus to when the tour closes. */
  trigger?: HTMLElement | null;
}

const POPOVER_SELECTOR = '.driver-popover';

/**
 * Owns one Driver.js instance. Never auto-starts: callers start explicitly
 * from user gestures. Destroys on unmount; callers destroy on route change.
 *
 * End-of-tour handling does not rely on driver lifecycle hooks: it watches
 * for the popover leaving the DOM while a tour is active (covers
 * Escape/close/overlay/Done uniformly) and ignores removals while the
 * driver still reports itself active (step transitions).
 */
export function useProductTour() {
  const driverRef = useRef<Driver | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const routeRef = useRef<TourRoute | null>(null);
  const activeRef = useRef(false);

  const finalizeTour = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    routeRef.current = null;
    driverRef.current = null;
    trigger?.focus();
  }, []);

  const destroyTour = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
    if (document.querySelector(POPOVER_SELECTOR) === null) finalizeTour();
  }, [finalizeTour]);

  const startTour = useCallback(
    (steps: readonly TourStep[], options: StartOptions): boolean => {
      destroyTour();
      const available = steps.filter((s) => document.querySelector(s.element) !== null);
      if (available.length === 0) return false;
      triggerRef.current = options.trigger ?? null;
      routeRef.current = options.route;
      const instance = driver({
        animate: !prefersReducedMotion(),
        smoothScroll: true,
        overlayColor: 'rgba(2, 6, 23, 0.78)',
        overlayOpacity: 0.78,
        stagePadding: 8,
        stageRadius: 12,
        popoverClass: 'deployiq-tour',
        showProgress: true,
        progressText: 'Step {{current}} of {{total}}',
        doneBtnText: 'Done',
        nextBtnText: 'Next →',
        prevBtnText: '← Back',
        allowKeyboardControl: true,
        disableActiveInteraction: true,
        skipMissingElement: true,
        steps: available.map((s) => ({
          element: s.element,
          popover: { title: s.title, description: s.description },
        })),
        onDoneClick: () => {
          if (routeRef.current) markTourCompleted(routeRef.current);
          destroyTour();
        },
      });
      driverRef.current = instance;
      activeRef.current = true;
      instance.drive();
      return true;
    },
    [destroyTour],
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!activeRef.current) return;
      if (document.querySelector(POPOVER_SELECTOR) !== null) return;
      if (driverRef.current?.isActive()) return;
      finalizeTour();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      destroyTour();
    };
  }, [destroyTour, finalizeTour]);

  return { startTour, destroyTour };
}
