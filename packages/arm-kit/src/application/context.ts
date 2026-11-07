import type {
  CartesianPose,
  MotionOptions,
  RobotArmProfile,
  ScreenProfile,
  ToolProfile,
} from '../contracts.js';
export interface ApplicationContext {
  robot: RobotArmProfile;
  tool: ToolProfile;
  screen: ScreenProfile;
}
export interface MotionTarget {
  name: string;
  pose: CartesianPose;
  options: MotionOptions;
}
