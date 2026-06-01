import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED } from "../option-presets.ts";

export const leak: CanonicalCategory = {
  category: "leak",
  subcategories: [
    {
      slug: "brown_or_black_puddle_engine_oil",
      display_label: "Brown or black puddle (engine oil)",
      display_order: 1,
      questions: [
        {
          text: "Is the puddle showing up under the front or middle of the car, roughly under the engine?",
          multi_select: false,
          options: [
            { label: "Front", value: "front" },
            { label: "Middle (under engine)", value: "middle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the spot feel thick and slippery between your fingers, almost like cooking oil?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you smelled anything burning or seen smoke coming from under the hood while driving?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the oil-can warning light on your dashboard turned on at all?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had to add engine oil between oil changes lately, or is the dipstick reading low?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "About how big is the spot — a few drops the size of a quarter, a saucer-sized stain, or a wider puddle?",
          multi_select: false,
          options: [
            { label: "A few drops (quarter-size)", value: "drops" },
            { label: "Saucer-sized stain", value: "saucer" },
            { label: "Wider puddle", value: "puddle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it only leak after you've been driving, or do you see fresh drops even after the car has sat overnight?",
          multi_select: false,
          options: [
            { label: "Only after driving", value: "after_driving" },
            { label: "Fresh drops after sitting", value: "after_sitting" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "green_orange_yellow_or_pink_puddle_coolant",
      display_label: "Green, orange, yellow, or pink puddle (antifreeze / coolant)",
      display_order: 2,
      questions: [
        {
          text: "Does the fluid look bright or neon-colored — green, orange, yellow, or pink?",
          multi_select: true,
          options: [
            { label: "Green", value: "green" },
            { label: "Orange", value: "orange" },
            { label: "Yellow", value: "yellow" },
            { label: "Pink", value: "pink" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed a sweet smell, kind of like maple syrup or pancake syrup, around the car or inside the cabin?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the temperature gauge been creeping toward hot, or has the car overheated recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the puddle showing up under the front of the car, near the radiator area?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had to add antifreeze to the reservoir under the hood, or has the level dropped?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Do you see any steam rising from under the hood when you stop after a drive?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the inside of the windshield fog up oddly, or do you smell that sweet smell from the vents when the heater is on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "red_or_pink_puddle_transmission_or_power_steering",
      display_label: "Red or pink puddle (transmission or power steering fluid)",
      display_order: 3,
      questions: [
        {
          text: "Where is the leak showing up — more toward the middle of the car or up near the front by the engine?",
          multi_select: false,
          options: [
            { label: "Middle of the car", value: "middle" },
            { label: "Near the front / engine", value: "front" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When you turn the steering wheel, does it feel heavier than usual or make a whining or groaning noise?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When you shift into Drive or Reverse, does it hesitate, slip, or feel rough?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the fluid bright red or pink, or has it darkened to a brownish-red color?",
          multi_select: false,
          options: [
            { label: "Bright red or pink", value: "bright" },
            { label: "Brownish-red", value: "brown" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you had to top off the power steering reservoir under the hood recently?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the leak happen more when the car is parked after driving, or also when it sits unused for a day?",
          multi_select: false,
          options: [
            { label: "After driving", value: "after_driving" },
            { label: "Also when sitting unused", value: "sitting" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you mainly see the spot after the car has been running, or is it there first thing in the morning too?",
          multi_select: false,
          options: [
            { label: "After running", value: "running" },
            { label: "Also in the morning", value: "morning_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "clear_yellow_or_light_brown_puddle_brake_fluid",
      display_label: "Clear, yellow, or light brown puddle (brake fluid — safety concern)",
      display_order: 4,
      questions: [
        {
          text: "Does the brake pedal feel soft, spongy, or sink lower than normal when you press it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the brake pedal ever gone almost all the way to the floor?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the red brake warning light or the ABS light come on recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the fluid slick and oily but clear-to-yellowish, and does it have an unpleasant fishy or oily smell?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Where is the spot showing up — near a wheel, under the middle of the car, or up under the engine bay on the driver's side?",
          multi_select: false,
          options: [
            { label: "Near a wheel", value: "wheel" },
            { label: "Middle of the car", value: "middle" },
            { label: "Engine bay (driver's side)", value: "engine_bay" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the car pull to one side when you brake, or does stopping take longer than it used to?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you checked the small reservoir under the hood marked \"brake fluid\" — does it look low?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "clear_odorless_puddle_water_or_ac_condensation",
      display_label: "Clear, odorless puddle (likely water / AC condensation)",
      display_order: 5,
      questions: [
        {
          text: "Does the puddle show up only after you've been running the air conditioner, especially on a warm or humid day?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the fluid completely clear, with no color and no smell at all?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the spot small — like a few drops or a wet patch — and toward the front-passenger side of the car?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the spot dry up quickly and leave no stain or residue behind?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any wet carpet inside the car, especially on the passenger-side floorboard?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the leak ever appear when the AC has not been on, or only after AC use?",
          multi_select: false,
          options: [
            { label: "Only after AC use", value: "ac_only" },
            { label: "Even when AC is off", value: "ac_off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you driven through any deep puddles or had heavy rain recently that could have left water behind?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "thick_dark_brown_puddle_gear_or_differential_oil",
      display_label: "Thick dark brown puddle with strong smell (gear / differential oil)",
      display_order: 6,
      questions: [
        {
          text: "Is the spot showing up under the very back of the car, near the rear axle, or under a four-wheel-drive vehicle's middle area?",
          multi_select: false,
          options: [
            { label: "Rear axle / back of car", value: "rear" },
            { label: "Middle (4WD)", value: "middle_4wd" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the fluid smell strong and unpleasant — kind of like rotten eggs or sulfur?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the fluid thick and dark — darker and heavier-looking than regular engine oil?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear any whining, humming, or grinding noise from the back of the car that gets louder with speed?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you felt any vibrations or clunking, especially during turns or when accelerating?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the leak look like it's coming from a round, pumpkin-shaped housing on the rear axle?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the vehicle been used recently for towing, off-roading, or hauling heavy loads?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "blue_or_light_blue_puddle_washer_fluid",
      display_label: "Blue or light blue puddle (windshield washer fluid)",
      display_order: 7,
      questions: [
        {
          text: "Is the fluid a bright blue or blue-green color, and does it have a soapy or chemical smell?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the spot show up near the front of the car, just behind the front bumper?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When you press the washer button, does any fluid actually reach the windshield, or has the spray weakened?",
          multi_select: false,
          options: [
            { label: "Reaches the windshield", value: "reaches" },
            { label: "Spray weakened", value: "weak" },
            { label: "No spray at all", value: "none" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you had to refill the washer fluid reservoir more often than usual?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the fluid feel watery and thin rather than oily?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the leak happen only after you've used the windshield washers, or does it drip all the time?",
          multi_select: false,
          options: [
            { label: "Only after using washers", value: "after_use" },
            { label: "Drips all the time", value: "always" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you recently been in cold weather where the washer fluid lines could have frozen and cracked?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
  ],
};

// 5. NOISE
