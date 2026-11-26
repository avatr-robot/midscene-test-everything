import { expect, it } from '@rstest/core';
import {
  cameraViewpointAssignments,
  cameraViewpointCandidates,
  cameraViewpointOf,
} from '../src/ui/cameras';

it('assigns the opposite viewpoint to the other camera', () => {
  const cameras = [
    { id: 'side', kind: 'color' as const, label: 'top' as const },
    { id: 'overhead', kind: 'color' as const, label: 'front' as const },
  ];

  expect(cameraViewpointAssignments(cameras, 'side', 'front')).toEqual([
    { id: 'side', label: 'front' },
    { id: 'overhead', label: 'top' },
  ]);
  expect(cameraViewpointAssignments(cameras, 'overhead', 'top')).toEqual([
    { id: 'overhead', label: 'top' },
    { id: 'side', label: 'front' },
  ]);
});

it('uses the first color camera when neither position has been assigned', () => {
  expect(
    cameraViewpointAssignments(
      [
        { id: 'first', kind: 'color' as const },
        { id: 'second', kind: 'color' as const },
      ],
      'first',
      'top',
    ),
  ).toEqual([
    { id: 'first', label: 'top' },
    { id: 'second', label: 'front' },
  ]);
});

it('does not assign a viewpoint without a second color camera', () => {
  expect(
    cameraViewpointAssignments(
      [
        { id: 'color', kind: 'color' as const },
        { id: 'depth', kind: 'depth' as const },
      ],
      'color',
      'front',
    ),
  ).toEqual([]);
  expect(cameraViewpointOf('left')).toBeUndefined();
});

it('uses only running color cameras for mutual viewpoint assignment', () => {
  expect(
    cameraViewpointCandidates([
      { id: 'side', kind: 'color' as const, stream: { state: 'running' } },
      {
        id: 'overhead',
        kind: 'color' as const,
        stream: { state: 'starting' },
      },
      { id: 'stopped', kind: 'color' as const, stream: { state: 'stopped' } },
      { id: 'depth', kind: 'depth' as const, stream: { state: 'running' } },
    ]).map((camera) => camera.id),
  ).toEqual(['side', 'overhead']);
});
