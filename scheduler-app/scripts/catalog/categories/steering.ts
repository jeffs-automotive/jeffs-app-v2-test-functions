import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, SUDDEN_GRADUAL } from "../option-presets.ts";

export const steering: CanonicalCategory = {
  category: "steering",
  subcategories: [
    {
      slug: "hard_to_turn_heavy_steering",
      display_label: "Hard to turn / heavy steering",
      display_order: 1,
      questions: [
        {
          text: "Is it harder to turn the wheel at low speeds and parking, or also at higher speeds?",
          multi_select: false,
          options: [
            { label: "Low speeds / parking", value: "low" },
            { label: "Also at higher speeds", value: "high_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this come on suddenly overnight, or has it gotten gradually worse over days or weeks?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Is it equally hard to turn in both directions, or worse turning one way than the other?",
          multi_select: false,
          options: [
            { label: "Equally hard both ways", value: "equal" },
            { label: "Worse turning left", value: "left" },
            { label: "Worse turning right", value: "right" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any red or pink fluid spots under the front of the car where you park?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Do you hear any whining, groaning, or humming sound while turning?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does your car have power steering you can feel quitting, or has the wheel always felt this stiff since you got it?",
          multi_select: false,
          options: [
            { label: "Power steering quit recently", value: "quit" },
            { label: "Always felt this stiff", value: "always" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the battery been dying or have any warning lights been on the dashboard recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "loose_or_sloppy_steering",
      display_label: "Loose or sloppy steering",
      display_order: 2,
      questions: [
        {
          text: "Can you wiggle the steering wheel a little bit side-to-side before the car actually starts to turn?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you find yourself constantly making small corrections to keep the car going straight?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car feel floaty or disconnected from the road, like it's not really tracking where you point it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you hit any large potholes, curbs, or had a fender-bender recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are your front tires wearing more on the inside or outside edges than in the middle?",
          multi_select: false,
          options: [
            { label: "Inside edges", value: "inside" },
            { label: "Outside edges", value: "outside" },
            { label: "Even wear", value: "even" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the looseness feel worse at higher speeds, lower speeds, or about the same all the time?",
          multi_select: false,
          options: [
            { label: "Worse at higher speeds", value: "high" },
            { label: "Worse at lower speeds", value: "low" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "About how many miles are on the car, and do you know roughly when the front-end parts were last looked at?",
          multi_select: false,
          options: [
            { label: "Under 50k miles", value: "lt_50k" },
            { label: "50k-100k miles", value: "50_to_100k" },
            { label: "100k-150k miles", value: "100_to_150k" },
            { label: "Over 150k miles", value: "gt_150k" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "steering_wheel_off_center_when_driving_straight",
      display_label: "Steering wheel off-center when driving straight",
      display_order: 3,
      questions: [
        {
          text: "When the car is going straight down a flat road, is the steering wheel tilted left or right of center?",
          multi_select: false,
          options: [
            { label: "Tilted left", value: "left" },
            { label: "Tilted right", value: "right" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this start right after a recent alignment, tire rotation, or other suspension work?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you hit a curb, pothole, or had any kind of impact to the front of the car recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car still drive straight, or does it also pull to one side along with the wheel being crooked?",
          multi_select: false,
          options: [
            { label: "Drives straight", value: "straight" },
            { label: "Also pulls to one side", value: "pulls" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have any tires been replaced recently, and if so were all four done or just some of them?",
          multi_select: false,
          options: [
            { label: "All four replaced", value: "all" },
            { label: "Just some replaced", value: "some" },
            { label: "No recent replacement", value: "none" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are all four tires the same brand, model, and roughly the same age?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you remember when you last had the tire pressures checked on all four corners?",
          multi_select: false,
          options: [
            { label: "In the last month", value: "recent" },
            { label: "Several months ago", value: "months" },
            { label: "Over a year ago", value: "year_plus" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "noise_when_turning_the_steering_wheel",
      display_label: "Noise when turning the steering wheel",
      display_order: 4,
      questions: [
        {
          text: "What does the sound feel like — a whine or hum, a clicking or popping, a creak, or a clunk?",
          multi_select: false,
          options: [
            { label: "Whine or hum", value: "whine" },
            { label: "Clicking or popping", value: "clicking" },
            { label: "Creak", value: "creak" },
            { label: "Clunk", value: "clunk" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the noise happen mostly at low speeds and parking, or also at higher speeds?",
          multi_select: false,
          options: [
            { label: "Low speeds / parking", value: "low" },
            { label: "Also at higher speeds", value: "high_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is it louder when you turn the wheel all the way to one side and hold it there?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise happen even when the car isn't moving, just turning the wheel while parked?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it sound like it's coming from the front wheels, the engine bay, or somewhere underneath?",
          multi_select: false,
          options: [
            { label: "Front wheels", value: "front_wheels" },
            { label: "Engine bay", value: "engine_bay" },
            { label: "Underneath", value: "underneath" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you checked the power steering fluid level recently, or do you know if it's low?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the noise change or go away in cold weather versus warm weather?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "steering_wheel_shakes_at_highway_speed",
      display_label: "Steering wheel shakes at highway speed",
      display_order: 5,
      questions: [
        {
          text: "At what speed does the shake start, and does it get worse the faster you go or eventually smooth back out?",
          multi_select: false,
          options: [
            { label: "Worse the faster I go", value: "worse" },
            { label: "Smooths out past a point", value: "smooths" },
            { label: "Same regardless", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the shake happen all the time at that speed, or only when you press the brakes?",
          multi_select: false,
          options: [
            { label: "All the time at that speed", value: "always" },
            { label: "Only when braking", value: "braking" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "If you briefly let go of the wheel at highway speed, does the shake continue or quiet down?",
          multi_select: false,
          options: [
            { label: "Continues", value: "continues" },
            { label: "Quiets down", value: "quiets" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the whole car shaking, or is it really just the steering wheel in your hands?",
          multi_select: false,
          options: [
            { label: "Whole car shakes", value: "whole" },
            { label: "Just the steering wheel", value: "wheel" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When were your tires last balanced or rotated?",
          multi_select: false,
          options: [
            { label: "In the last 6 months", value: "lt_6_months" },
            { label: "6-12 months ago", value: "6_to_12" },
            { label: "Over a year ago", value: "gt_year" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you recently lost a wheel weight or hit something that could have knocked a tire out of balance?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are any of the tires showing uneven wear, scalloped patches, or bald spots?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "pulling_drifting_or_wandering_on_the_road",
      display_label: "Pulling, drifting, or wandering on the road",
      display_order: 6,
      questions: [
        {
          text: "Does the car pull steadily to one specific side, or does it wander back and forth between lanes?",
          multi_select: false,
          options: [
            { label: "Pulls steadily one side", value: "steady" },
            { label: "Wanders back and forth", value: "wander" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Which direction does it pull — always left, always right, or it changes?",
          multi_select: false,
          options: [
            { label: "Always left", value: "left" },
            { label: "Always right", value: "right" },
            { label: "Changes", value: "changes" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the pull happen on flat roads too, or mostly on roads that slope to one side?",
          multi_select: false,
          options: [
            { label: "On flat roads too", value: "flat" },
            { label: "Mostly on sloped roads", value: "slope" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it pull harder when you press the brakes, when you accelerate, or about the same regardless?",
          multi_select: false,
          options: [
            { label: "Worse when braking", value: "braking" },
            { label: "Worse when accelerating", value: "accel" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When was the last time the tires were rotated, replaced, or had pressures checked?",
          multi_select: false,
          options: [
            { label: "In the last 3 months", value: "lt_3_months" },
            { label: "3-12 months ago", value: "3_to_12" },
            { label: "Over a year ago", value: "gt_year" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you been in a recent accident, hit a big pothole, or run over a curb?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had an alignment done recently, and did the problem start before or after that?",
          multi_select: false,
          options: [
            { label: "Started before alignment", value: "before" },
            { label: "Started after alignment", value: "after" },
            { label: "No recent alignment", value: "none" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "clunking_knocking_or_rough_ride_over_bumps",
      display_label: "Clunking, knocking, or rough ride over bumps",
      display_order: 7,
      questions: [
        {
          text: "Does the noise happen every time you go over a bump, or only over bigger ones?",
          multi_select: false,
          options: [
            { label: "Every bump", value: "every" },
            { label: "Only bigger bumps", value: "big_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the front of the car keep bouncing two or three times after a bump instead of settling right away?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the front end dip down hard when you brake, or does the back end squat down hard when you accelerate?",
          multi_select: true,
          options: [
            { label: "Front dips when braking", value: "front_dip" },
            { label: "Rear squats when accelerating", value: "rear_squat" },
            { label: "Neither", value: "neither" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the car lean or sway a lot when you go around corners or change lanes quickly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Where does the clunking seem to come from — front left, front right, or the back of the car?",
          multi_select: true,
          options: [
            { label: "Front left", value: "front_left" },
            { label: "Front right", value: "front_right" },
            { label: "Back of the car", value: "rear" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any oily or wet streaks running down the metal posts behind the front wheels?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "About how many miles are on the car, and have the shocks or suspension parts ever been replaced?",
          multi_select: false,
          options: [
            { label: "Under 75k, never replaced", value: "lt_75k_original" },
            { label: "Over 75k, never replaced", value: "gt_75k_original" },
            { label: "Replaced at some point", value: "replaced" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 12. TIRES
