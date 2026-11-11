import { describe, expect, it } from '@rstest/core';
import {
  type PerspectiveValidityResult,
  checkPerspectiveValidity,
  prepareValidityFrame,
} from '../src/camera/perspective-validity.js';
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SCREEN,
  expand,
  quadOf,
  renderFrame,
  rotateQuad,
} from './fixtures/perspective-frame.js';

async function check(
  frame: Awaited<ReturnType<typeof renderFrame>>,
): Promise<PerspectiveValidityResult> {
  return checkPerspectiveValidity({
    jpeg: frame.jpeg,
    points: frame.points,
    sourceWidth: frame.sourceWidth,
    sourceHeight: frame.sourceHeight,
  });
}

describe('perspective validity', () => {
  it('accepts clear on-edge evidence within the two-pixel measurement tolerance on a narrow screen', async () => {
    const screen = { ...SCREEN, width: 330 };
    const validity = await check(
      await renderFrame({
        screen,
        quad: { ...screen, x: screen.x + 1, y: screen.y + 1 },
      }),
    );
    expect(
      validity.edges.filter((edge) => edge.class === 'on-edge').length,
    ).toBeGreaterThanOrEqual(3);
    expect(validity.driftPx).toBeLessThanOrEqual(2);
    expect(validity.state).toBe('valid');
  });
  it('accepts a quadrilateral that still follows the glass', async () => {
    const validity = await check(await renderFrame({ screen: SCREEN }));
    expect(validity.verdict).toBe('aligned');
    expect(validity.state).toBe('valid');
    expect(validity.reasonCode).toBe('ALIGNED');
    expect(
      validity.edges.filter((edge) => edge.class === 'on-edge'),
    ).toHaveLength(4);
    expect(validity.driftRatio).toBeLessThan(0.003);
    expect(validity.band.foreignSides).toEqual([]);
  });

  it('rejects a quadrilateral that is clearly larger than the screen', async () => {
    const validity = await check(
      await renderFrame({ screen: SCREEN, quad: expand(SCREEN, 0.12) }),
    );
    expect(validity.state).toBe('invalid');
    expect(validity.verdict).toBe('mismatch');
    expect(validity.reasonCode).toBe('OFF_SCREEN_BOUNDARY');
    expect(validity.band.foreignSides.length).toBeGreaterThanOrEqual(3);
    // No saved edge is on the glass; the scan only finds the body edge inside.
    expect(validity.edges.every((edge) => edge.class !== 'on-edge')).toBe(true);
  });

  it('rejects a phone that moved while the saved quadrilateral stayed', async () => {
    const moved = { ...SCREEN, x: SCREEN.x + 22 };
    const validity = await check(
      await renderFrame({ screen: moved, quad: SCREEN }),
    );
    expect(validity.state).toBe('invalid');
    expect(validity.verdict).toBe('mismatch');
    expect(validity.driftRatio).toBeGreaterThan(0.01);
    // The glass edge is 22 px inside the saved left edge and 22 px outside the
    // saved right edge, so both of those edges leave the glass.
    const offEdge = validity.edges.filter((edge) => edge.class === 'off-edge');
    expect(offEdge.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a rotated outline even when every edge still finds a gradient', async () => {
    const validity = await check(
      await renderFrame({ screen: SCREEN, points: rotateQuad(SCREEN, 1.2) }),
    );
    expect(validity.state).toBe('invalid');
    expect(validity.verdict).toBe('mismatch');
    expect(validity.reasonCode).toBe('ROTATED');
    expect(validity.driftRatio).toBeGreaterThanOrEqual(0.01);
    // The phone body cannot explain a rotation, so the on-edge classes alone
    // must not keep the saved outline looking acceptable.
    expect(
      validity.edges.filter((edge) => edge.class === 'off-edge'),
    ).toHaveLength(0);
  });

  it('reports an unreadable dark scene instead of guessing', async () => {
    const validity = await check(
      await renderFrame({
        screen: SCREEN,
        desk: '#1b1b1b',
        body: '#101012',
        glass: '#16161a',
        iconColor: '#191920',
      }),
    );
    expect(validity.verdict).toBe('uncertain');
    expect(validity.state).toBe('unverified');
    expect(validity.edges.every((edge) => edge.class !== 'on-edge')).toBe(true);
    expect(validity.texture.inside).toBeLessThan(5);
  });

  it('does not reject a correct quadrilateral because a stylus crosses one edge', async () => {
    const validity = await check(
      await renderFrame({
        screen: SCREEN,
        extra: `<line x1="300" y1="120" x2="392" y2="196" stroke="#b9bec6" stroke-width="16" stroke-linecap="round"/>`,
      }),
    );
    expect(validity.state).not.toBe('invalid');
  });

  it('does not read a blank white screen as a foreign band', async () => {
    const validity = await check(
      await renderFrame({
        screen: SCREEN,
        desk: '#f4f4f4',
        body: '#2a2a2a',
        glass: '#fafafa',
        icons: false,
      }),
    );
    expect(validity.state).not.toBe('invalid');
    expect(validity.band.foreignSides).toEqual([]);
  });

  it('does not mistake the phone body edge for a moved screen', async () => {
    // Black glass on a black bezel against a bright desk: the strongest edge in
    // the search window is the body, and every offset points outward.
    const validity = await check(
      await renderFrame({
        screen: SCREEN,
        desk: '#f0f0f0',
        body: '#0a0a0a',
        glass: '#050505',
        iconColor: '#0d0d0d',
      }),
    );
    expect(validity.state).not.toBe('invalid');
    expect(validity.band.foreignSides).toEqual([]);
  });

  it('does not fail a correct outline because the page keeps a status bar', async () => {
    // A phone that cannot hide its status bar keeps a bright strip inside the
    // top of the glass; the glass edge above it is not measurable there. The
    // outline is still the glass, so the strip must stay a reported band rather
    // than become a mismatch.
    const validity = await check(
      await renderFrame({
        screen: SCREEN,
        icons: false,
        // The bright strip and the desk above it share one level, so the glass
        // edge is invisible on that side: only the strip's inner boundary lies
        // inside the outline, too far inside to count as the glass edge.
        desk: '#fafafa',
        extra: `<rect x="${SCREEN.x - 14}" y="${SCREEN.y - 14}" width="${SCREEN.width + 28}" height="44" fill="#fafafa"/>`,
      }),
    );
    expect(validity.band.foreignSides).toEqual(['top']);
    expect(validity.edges.find((edge) => edge.side === 'top')?.class).toBe(
      'no-edge',
    );
    expect(
      validity.edges.filter((edge) => edge.class === 'on-edge').length,
    ).toBe(3);
    expect(validity.state).toBe('valid');
    expect(validity.reasonCode).toBe('ALIGNED');
  });

  it('still rejects one loose side when only that side shows a band', async () => {
    // The saved outline reaches 24 px above the glass on the top side only.
    // Three edges stay aligned, but the geometry is outside the alignment
    // tolerance, so the single band is real evidence of an over-large outline.
    const taller = {
      ...SCREEN,
      y: SCREEN.y - 24,
      height: SCREEN.height + 24,
    };
    const validity = await check(
      await renderFrame({ screen: SCREEN, quad: taller }),
    );
    expect(validity.band.foreignSides).toEqual(['top']);
    expect(validity.state).toBe('invalid');
  });

  it('returns the same verdict from a frame it did not decode itself', async () => {
    const frame = await renderFrame({ screen: SCREEN });
    const prepared = await prepareValidityFrame(frame);
    const direct = await checkPerspectiveValidity(frame);
    const reused = await checkPerspectiveValidity(frame, prepared);
    expect(reused).toEqual(direct);
  });
});
