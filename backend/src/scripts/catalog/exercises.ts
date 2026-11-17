export type ExerciseKind = 'weight_reps' | 'bodyweight_reps' | 'duration' | 'distance_duration';

export interface CatalogExercise {
  name: string;
  muscleGroup: string;
  equipment: string;
  kind: ExerciseKind;
}

const e = (name: string, muscleGroup: string, equipment: string, kind: ExerciseKind = 'weight_reps'): CatalogExercise => ({
  name,
  muscleGroup,
  equipment,
  kind,
});

export const exercises: CatalogExercise[] = [
  // Chest
  e('Barbell bench press', 'Chest', 'Barbell'),
  e('Incline dumbbell press', 'Chest', 'Dumbbell'),
  e('Dumbbell bench press', 'Chest', 'Dumbbell'),
  e('Cable chest fly', 'Chest', 'Cable'),
  e('Machine chest press', 'Chest', 'Machine'),
  e('Push-up', 'Chest', 'Bodyweight', 'bodyweight_reps'),
  e('Dips', 'Chest', 'Bodyweight', 'bodyweight_reps'),
  // Back
  e('Deadlift', 'Back', 'Barbell'),
  e('Barbell row', 'Back', 'Barbell'),
  e('Dumbbell row', 'Back', 'Dumbbell'),
  e('Lat pulldown', 'Back', 'Cable'),
  e('Seated cable row', 'Back', 'Cable'),
  e('Pull-up', 'Back', 'Bodyweight', 'bodyweight_reps'),
  e('Chin-up', 'Back', 'Bodyweight', 'bodyweight_reps'),
  // Legs
  e('Barbell back squat', 'Legs', 'Barbell'),
  e('Front squat', 'Legs', 'Barbell'),
  e('Leg press', 'Legs', 'Machine'),
  e('Romanian deadlift', 'Legs', 'Barbell'),
  e('Walking lunge', 'Legs', 'Dumbbell'),
  e('Bulgarian split squat', 'Legs', 'Dumbbell'),
  e('Leg extension', 'Legs', 'Machine'),
  e('Lying leg curl', 'Legs', 'Machine'),
  e('Standing calf raise', 'Legs', 'Machine'),
  e('Hip thrust', 'Glutes', 'Barbell'),
  // Shoulders
  e('Overhead press', 'Shoulders', 'Barbell'),
  e('Dumbbell shoulder press', 'Shoulders', 'Dumbbell'),
  e('Lateral raise', 'Shoulders', 'Dumbbell'),
  e('Rear delt fly', 'Shoulders', 'Dumbbell'),
  e('Face pull', 'Shoulders', 'Cable'),
  // Arms
  e('Barbell curl', 'Biceps', 'Barbell'),
  e('Dumbbell curl', 'Biceps', 'Dumbbell'),
  e('Hammer curl', 'Biceps', 'Dumbbell'),
  e('Triceps pushdown', 'Triceps', 'Cable'),
  e('Skull crusher', 'Triceps', 'EZ bar'),
  e('Overhead triceps extension', 'Triceps', 'Dumbbell'),
  // Core
  e('Plank', 'Core', 'Bodyweight', 'duration'),
  e('Hanging leg raise', 'Core', 'Bodyweight', 'bodyweight_reps'),
  e('Cable crunch', 'Core', 'Cable'),
  e('Ab wheel rollout', 'Core', 'Ab wheel', 'bodyweight_reps'),
  // Cardio
  e('Treadmill run', 'Cardio', 'Treadmill', 'distance_duration'),
  e('Outdoor run', 'Cardio', 'None', 'distance_duration'),
  e('Walking', 'Cardio', 'None', 'distance_duration'),
  e('Stationary bike', 'Cardio', 'Bike', 'distance_duration'),
  e('Rowing machine', 'Cardio', 'Rower', 'distance_duration'),
  e('Stair climber', 'Cardio', 'Machine', 'duration'),
  e('Jump rope', 'Cardio', 'Rope', 'duration'),
];
