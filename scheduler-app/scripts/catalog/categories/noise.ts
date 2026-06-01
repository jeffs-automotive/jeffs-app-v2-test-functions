import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SUDDEN_GRADUAL } from "../option-presets.ts";

export const noise: CanonicalCategory = {
  category: "noise",
  subcategories: [
    {
      slug: "engine_ticking_or_tapping",
      display_label: "Engine ticking or tapping",
      display_order: 1,
      questions: [
        {
          text: "Does the ticking start the moment you turn the key, or does it only show up after the engine has been running for a few minutes?",
          multi_select: false,
          options: [
            { label: "Right when I turn the key", value: "key" },
            { label: "After a few minutes", value: "few_minutes" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the speed of the ticking change as you press the gas pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the sound coming from the top of the engine or the lower part of the engine?",
          multi_select: false,
          options: [
            { label: "Top of the engine", value: "top" },
            { label: "Lower part of the engine", value: "lower" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When was the last time you had the oil changed?",
          multi_select: false,
          options: [
            { label: "In the last 3 months", value: "lt_3_months" },
            { label: "3 to 6 months ago", value: "3_to_6" },
            { label: "Over 6 months ago", value: "gt_6" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the oil pressure warning light flicker on, even briefly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the ticking get quieter or go away once the engine warms up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise get louder when the engine is working hard, like going up a hill or carrying heavy loads?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "clunking_over_bumps",
      display_label: "Clunking over bumps",
      display_order: 2,
      questions: [
        {
          text: "Does the clunk happen every time you hit a bump, or only with big bumps and potholes?",
          multi_select: false,
          options: [
            { label: "Every bump", value: "every" },
            { label: "Only big bumps/potholes", value: "big_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the sound coming from the front of the vehicle, the back, or both?",
          multi_select: true,
          options: [
            { label: "Front", value: "front" },
            { label: "Back", value: "rear" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the clunk happen on just one side of the car, or both sides equally?",
          multi_select: true,
          options: [
            { label: "Left side", value: "left" },
            { label: "Right side", value: "right" },
            { label: "Both sides equally", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the vehicle feeling bouncy or unsettled after going over bumps?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the clunk also happen when you start moving from a stop or when you come to a stop?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you hit any large potholes, curbs, or road debris recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise happen at any speed, or only at low speeds?",
          multi_select: false,
          options: [
            { label: "Any speed", value: "any" },
            { label: "Only at low speeds", value: "low" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "humming_or_whirring_at_speed",
      display_label: "Humming or whirring at speed",
      display_order: 3,
      questions: [
        {
          text: "Does the hum get louder the faster you drive?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise change when you turn the steering wheel left versus right?",
          multi_select: false,
          options: [
            { label: "Louder turning left", value: "left" },
            { label: "Louder turning right", value: "right" },
            { label: "No change", value: "no_change" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the sound seem to come from one specific wheel area, or is it hard to pin down?",
          multi_select: false,
          options: [
            { label: "Specific wheel", value: "specific" },
            { label: "Hard to pin down", value: "vague" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the hum stay the same when you take your foot off the gas and coast?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had new tires put on recently, or are your tires worn unevenly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise feel like it's coming through the floor or the seat as a vibration too?",
          multi_select: true,
          options: [
            { label: "Floor", value: "floor" },
            { label: "Seat", value: "seat" },
            { label: "Neither", value: "neither" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the hum disappear or get quieter when you're stopped at a light?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "high_pitched_whining_under_the_hood",
      display_label: "High-pitched whining under the hood",
      display_order: 4,
      questions: [
        {
          text: "Does the whine speed up and slow down along with the engine speed?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the whine get louder when you turn the steering wheel, especially when parking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it happen mostly when the engine is cold, when it's warm, or all the time?",
          multi_select: false,
          options: [
            { label: "When cold", value: "cold" },
            { label: "When warm", value: "warm" },
            { label: "All the time", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the whine get worse in cold or damp weather?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the battery warning light or dim headlights along with the noise?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the whine come from the front of the engine area where the belts are?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the noise start suddenly, or has it been getting worse gradually?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
      ],
    },
    {
      slug: "rattling_underneath_the_car",
      display_label: "Rattling underneath the car",
      display_order: 5,
      questions: [
        {
          text: "Does the rattle happen mostly at startup, when accelerating, or at idle?",
          multi_select: true,
          options: [
            { label: "At startup", value: "startup" },
            { label: "When accelerating", value: "accel" },
            { label: "At idle", value: "idle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the sound change or stop when you go over bumps versus smooth road?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the rattle more of a tinny sound, like a can with a rock in it, or more of a heavy clang?",
          multi_select: false,
          options: [
            { label: "Tinny / can with rock", value: "tinny" },
            { label: "Heavy clang", value: "heavy" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it get worse when the engine is revved up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you driven over anything in the road recently or scraped the underside of the car?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise come from the front, middle, or rear underside of the vehicle?",
          multi_select: false,
          options: [
            { label: "Front", value: "front" },
            { label: "Middle", value: "middle" },
            { label: "Rear", value: "rear" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the rattle quiet down once you're at cruising speed on the highway?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "hissing_noise",
      display_label: "Hissing noise",
      display_order: 6,
      questions: [
        {
          text: "Does the hiss happen with the engine off after you've shut the car down, or only when running?",
          multi_select: false,
          options: [
            { label: "Engine off, after shutdown", value: "off" },
            { label: "Only when running", value: "running" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the noise stop when you turn off the air conditioning?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the engine running rough, idling unevenly, or a warning light coming on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the temperature gauge running higher than normal, or have you seen steam from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the hiss seem to come from under the hood, from underneath the car, or from the dashboard area?",
          multi_select: false,
          options: [
            { label: "Under the hood", value: "hood" },
            { label: "Underneath the car", value: "underneath" },
            { label: "Dashboard area", value: "dash" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the air conditioning still blow cold, or has it gotten weaker?",
          multi_select: false,
          options: [
            { label: "Still cold", value: "cold" },
            { label: "Weaker", value: "weak" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you topped off coolant or refrigerant recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "popping_or_clicking_when_turning",
      display_label: "Popping or clicking when turning",
      display_order: 7,
      questions: [
        {
          text: "Does the popping happen mostly during sharp turns, like in parking lots, or also during gentle turns?",
          multi_select: false,
          options: [
            { label: "Sharp turns only", value: "sharp" },
            { label: "Also during gentle turns", value: "gentle_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the noise louder when turning one direction versus the other?",
          multi_select: false,
          options: [
            { label: "Louder turning left", value: "left" },
            { label: "Louder turning right", value: "right" },
            { label: "Same both directions", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the popping get faster and louder the tighter you turn the wheel?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it happen when going forward, in reverse, or both?",
          multi_select: true,
          options: [
            { label: "Forward", value: "forward" },
            { label: "Reverse", value: "reverse" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any grease splattered on the back of your wheel or inside of your tire?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the noise happen even when you're not turning, or only during turns?",
          multi_select: false,
          options: [
            { label: "Only during turns", value: "turns_only" },
            { label: "Even when not turning", value: "not_turning_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you hit a deep pothole or scraped a curb recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "deep_knocking_from_the_engine",
      display_label: "Deep knocking from the engine",
      display_order: 8,
      questions: [
        {
          text: "Does the knock happen the moment you start the engine, or does it take a few minutes to show up?",
          multi_select: false,
          options: [
            { label: "Right at startup", value: "startup" },
            { label: "After a few minutes", value: "few_minutes" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the knocking get worse when you accelerate or are climbing a hill?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it get louder or quieter when the engine warms up?",
          multi_select: false,
          options: [
            { label: "Louder", value: "louder" },
            { label: "Quieter", value: "quieter" },
            { label: "No change", value: "no_change" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "What grade of gasoline have you been using, and does your owner's manual recommend a higher grade?",
          multi_select: false,
          options: [
            { label: "Regular — manual says regular is fine", value: "regular_ok" },
            { label: "Regular — manual recommends higher", value: "regular_low" },
            { label: "Premium / mid-grade", value: "premium" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any warning lights on the dashboard, especially the oil pressure light or check engine light?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the knocking a deep, heavy thumping or a lighter, faster tapping?",
          multi_select: false,
          options: [
            { label: "Deep, heavy thumping", value: "deep" },
            { label: "Lighter, faster tapping", value: "light" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you been low on oil recently, or has it been a long time since the last oil change?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "squeaking_or_creaking_over_bumps",
      display_label: "Squeaking or creaking over bumps",
      display_order: 9,
      questions: [
        {
          text: "Is the squeak worse when the car is cold in the morning, or when it's warmed up?",
          multi_select: false,
          options: [
            { label: "Worse when cold", value: "cold" },
            { label: "Worse when warm", value: "warm" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the squeak only happen over bumps, or also when you turn the steering wheel while sitting still?",
          multi_select: false,
          options: [
            { label: "Only over bumps", value: "bumps_only" },
            { label: "Also when turning still", value: "turning_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it sound like dry rubber being twisted, or more like metal rubbing on metal?",
          multi_select: false,
          options: [
            { label: "Dry rubber", value: "rubber" },
            { label: "Metal on metal", value: "metal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the noise come from one corner of the car, or all around?",
          multi_select: false,
          options: [
            { label: "One corner", value: "one_corner" },
            { label: "All around", value: "all_around" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the squeak happen at low speeds only, or also on the highway?",
          multi_select: false,
          options: [
            { label: "Low speeds only", value: "low" },
            { label: "Also on highway", value: "highway_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the car been sitting outside in cold or wet weather a lot?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the squeak get worse when carrying passengers or heavy loads?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "electrical_buzzing",
      display_label: "Electrical buzzing",
      display_order: 10,
      questions: [
        {
          text: "Does the buzzing keep going even after you turn the engine off, or does it stop?",
          multi_select: false,
          options: [
            { label: "Keeps going after engine off", value: "continues" },
            { label: "Stops with engine", value: "stops" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the sound seem to come from the dashboard, behind the dash, or from under the hood?",
          multi_select: false,
          options: [
            { label: "Dashboard", value: "dash" },
            { label: "Behind the dash", value: "behind_dash" },
            { label: "Under the hood", value: "hood" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the buzz happen only when certain things are turned on, like the headlights, blower fan, or turn signals?",
          multi_select: true,
          options: [
            { label: "Headlights", value: "headlights" },
            { label: "Blower fan", value: "blower" },
            { label: "Turn signals", value: "signals" },
            { label: "All the time", value: "all_time" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the headlights or dashboard lights flickering or dimming?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any electrical work, accessories, or aftermarket items installed recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the battery seem weak, or does the car sometimes have trouble starting?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the buzzing happen all the time, or only at certain temperatures or weather conditions?",
          multi_select: false,
          options: [
            { label: "All the time", value: "all_time" },
            { label: "Certain temperatures/weather", value: "weather" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 6. OTHER
