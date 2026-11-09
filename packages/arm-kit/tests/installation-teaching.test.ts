import { expect, it } from '@rstest/core';
import { assertCameraBoundary } from '../src/application/teaching-constraints.js';
import type { InstallationTeaching } from '../src/contracts.js';
import { ProfileStore } from '../src/runtime/profile-store.js';
import { fixture, pose } from './fixtures.js';

it('persists mounting per camera, reuses it across screens and invalidates changed tool geometry', async () => {
  const f = await fixture();
  try {
    const teaching: InstallationTeaching = {
      id: 'mount',
      recordedAt: new Date().toISOString(),
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: f.tool.geometryRevision,
      referencePose: pose(100, 50, 80),
      poses: {
        reference: pose(100, 50, 80),
        cameraBoundary: pose(100, 100, 80),
      },
      cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
      corridorConfirmed: true,
    };
    await f.store.saveInstallationTeaching(teaching);
    const reloaded = new ProfileStore(f.store.filePath);
    await reloaded.load();
    const selection = {
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
    };
    expect(reloaded.installationTeaching(selection)?.id).toBe('mount');
    expect(
      reloaded.installationTeaching({ ...selection, cameraId: 'other' }),
    ).toBeUndefined();
    expect(() =>
      assertCameraBoundary(pose(10000, 100, 80), teaching, { tool: f.tool }),
    ).not.toThrow();
    expect(() =>
      assertCameraBoundary(pose(100, 100.01, 80), teaching, { tool: f.tool }),
    ).toThrow('boundary');
    await reloaded.putTool({ ...f.tool, offsetMm: { x: 0, y: 0, z: -100 } });
    expect(reloaded.installationTeaching(selection)).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});

it('rejects probe routes crossing a taught camera boundary before submitting movement', async () => {
  const f = await fixture();
  try {
    await f.store.saveInstallationTeaching({
      id: 'mount',
      recordedAt: new Date().toISOString(),
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: f.tool.geometryRevision,
      referencePose: pose(100, 50, 80),
      poses: {
        reference: pose(100, 50, 80),
        cameraBoundary: pose(100, 100, 80),
      },
      cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
      corridorConfirmed: true,
    });
    await expect(
      f.runtime.collectAutomaticPoints(
        { ...f.binding, cameraId: 'cam' },
        async (host) => {
          await host.preflight!([pose(100, 50, 80), pose(100, 101, 80)]);
          await host.move(pose(100, 50, 80));
        },
      ),
    ).rejects.toMatchObject({ code: 'CAMERA_BOUNDARY_EXCEEDED' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('keeps drag mode while capturing a persistent two-point draft and saves only the current confirmed draft', async () => {
  const f = await fixture();
  try {
    const binding = { ...f.binding, cameraId: 'cam' };
    await f.runtime.enterDragMode(binding);
    const reference = await f.runtime.captureInstallationPoint(
      binding,
      'reference',
    );
    expect((await f.runtime.state()).state.dragMode).toBe(true);
    expect(reference.poses.reference?.positionMm).toEqual({
      x: 100,
      y: -50,
      z: 100,
    });
    f.adapter.setPoseForTesting(pose(100, 20, 100));
    const boundary = await f.runtime.captureInstallationPoint(
      binding,
      'cameraBoundary',
    );
    expect((await f.runtime.state()).state.dragMode).toBe(true);
    const reloaded = new ProfileStore(f.store.filePath);
    await reloaded.load();
    expect(reloaded.list().installationTeachingDrafts?.[0].id).toBe(
      boundary.id,
    );
    await f.runtime.exitDragMode();
    await expect(
      f.runtime.teachInstallation({
        binding,
        draftId: reference.id,
        corridorConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    await expect(
      f.runtime.teachInstallation({
        binding,
        draftId: boundary.id,
        corridorConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const saved = await f.runtime.teachInstallation({
      binding,
      draftId: boundary.id,
      corridorConfirmed: true,
    });
    expect(saved.cameraBoundary.normal).toEqual({ x: 0, y: 1 });
    expect(saved.referenceDeviceId).toBe(f.screen.id);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
it('can confirm Drag exit after Stop while retaining the explicit recovery gate', async () => {
  const f = await fixture();
  try {
    await f.runtime.enterDragMode(f.binding);
    await f.runtime.stop();
    await f.runtime.exitDragMode();
    const state = await f.runtime.state(undefined, { fresh: true });
    expect(state.state.dragMode).toBe(false);
    expect(state.recoveryRequired).toBe(true);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
