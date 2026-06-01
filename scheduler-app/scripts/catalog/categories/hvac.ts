import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SUDDEN_GRADUAL, FOG_ALL_TIME } from "../option-presets.ts";

export const hvac: CanonicalCategory = {
  category: "hvac",
  subcategories: [
    {
      slug: "ac_blows_warm_or_hot_air",
      display_label: "AC blows warm or hot air",
      display_order: 1,
      questions: [
        {
          text: "Does the AC blow warm air all the time, or does it cool at first and then warm up after a few minutes of driving?",
          multi_select: false,
          options: [
            { label: "Warm all the time", value: "always_warm" },
            { label: "Cools first, then warms up", value: "cools_then_warms" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When you turn the AC on, do you hear a click from under the hood like something is kicking in?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the AC work better when you're driving on the highway versus sitting at a stoplight?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any oily or wet spots on the ground under the front of the car?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Has the AC ever been recharged, or had any work done on it in the last year or two?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Did the warm air start suddenly one day, or did the cooling get weaker little by little over time?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Does it blow warm from every vent (dash, floor, and defrost), or just some of them?",
          multi_select: false,
          options: [
            { label: "Every vent", value: "every" },
            { label: "Just some", value: "some" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "ac_is_weak_not_cold_enough",
      display_label: "AC is weak (not cold enough)",
      display_order: 2,
      questions: [
        {
          text: "Is the air at least somewhat cool, just not as cold as it used to be?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the air get colder when you press the recirculate or \"max AC\" button?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the cabin air filter been changed in the last year or two?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the AC cool better when the car is moving versus when you're parked?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any sweet or chemical smell along with the weak cooling?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the cooling slowly get worse over a season, or did it drop off all at once?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Does the system feel weak on hot, humid days but okay on cooler days?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "heat_doesnt_work",
      display_label: "Heat doesn't work",
      display_order: 3,
      questions: [
        {
          text: "Does the heater blow cold air, room-temperature air, or just a little warm?",
          multi_select: false,
          options: [
            { label: "Cold air", value: "cold" },
            { label: "Room-temperature air", value: "room_temp" },
            { label: "Just a little warm", value: "little_warm" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it take a long time of driving before any warm air comes out, or does it never warm up at all?",
          multi_select: false,
          options: [
            { label: "Takes a long time", value: "long_time" },
            { label: "Never warms up", value: "never" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the temperature gauge on the dash get up to its normal spot, or does it stay cold?",
          multi_select: false,
          options: [
            { label: "Reaches normal", value: "normal" },
            { label: "Stays cold", value: "cold" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you needed to add coolant or antifreeze recently, or noticed the coolant tank running low?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Have you seen any puddles or wet spots under the front of the car?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Is the heat the same on the driver and passenger side, or different?",
          multi_select: false,
          options: [
            { label: "Same on both sides", value: "same" },
            { label: "Different", value: "different" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the heat problem start after the car sat for a while, or after any recent service?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "vents_dont_blow_strongly",
      display_label: "Vents don't blow strongly (weak airflow)",
      display_order: 4,
      questions: [
        {
          text: "Is the air weak on every fan speed, or only on certain speeds (like only working on high)?",
          multi_select: false,
          options: [
            { label: "Weak on every speed", value: "every" },
            { label: "Only on certain speeds", value: "certain" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When was the cabin air filter last replaced?",
          multi_select: false,
          options: [
            { label: "In the last year", value: "lt_1_year" },
            { label: "1 to 3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the airflow weak from every vent, or only the dash, floor, or defrost?",
          multi_select: true,
          options: [
            { label: "Every vent", value: "every" },
            { label: "Dash vents", value: "dash" },
            { label: "Floor vents", value: "floor" },
            { label: "Defrost vents", value: "defrost" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the air come out stronger when you switch to recirculate?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you heard any squeaking, grinding, or rattling from behind the dashboard or passenger footwell?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the weak airflow start suddenly, or did it slowly drop off over months?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Does the fan come on at all when you turn it to the lowest speed?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "foggy_or_hard_to_defog_windows",
      display_label: "Foggy or hard-to-defog windows",
      display_order: 5,
      questions: [
        {
          text: "Do the windows fog up only on cold or rainy days, or all the time?",
          multi_select: false,
          options: FOG_ALL_TIME,
        },
        {
          text: "When you turn on defrost, does air actually come out of the vents at the bottom of the windshield?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the windshield clear up if you turn the AC on along with the defrost?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any wet carpet on the passenger side floor?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Do the inside of the windows look greasy or oily-streaked when you wipe them?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the back window defroster (the lines on the rear glass) work normally?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the fogging get worse when more passengers are in the car?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "strange_noise_from_vents",
      display_label: "Strange noise from vents",
      display_order: 6,
      questions: [
        {
          text: "What kind of noise is it: clicking, whistling, grinding, rattling, or buzzing?",
          multi_select: false,
          options: [
            { label: "Clicking", value: "clicking" },
            { label: "Whistling", value: "whistling" },
            { label: "Grinding", value: "grinding" },
            { label: "Rattling", value: "rattling" },
            { label: "Buzzing", value: "buzzing" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the noise happen only when the fan is on, or also when the fan is off?",
          multi_select: false,
          options: [
            { label: "Only when fan is on", value: "fan_on" },
            { label: "Also when fan is off", value: "fan_off_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the noise change when you raise or lower the fan speed?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise change when you switch the vents between dash, floor, and defrost?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the noise change when you switch between fresh air and recirculate?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the noise start after leaves, debris, or anything got near the cowl at the base of the windshield?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the noise coming from behind the dash, the passenger footwell, or under the hood?",
          multi_select: false,
          options: [
            { label: "Behind the dash", value: "dash" },
            { label: "Passenger footwell", value: "footwell" },
            { label: "Under the hood", value: "hood" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "bad_smell_from_vents",
      display_label: "Bad smell from vents (musty / sweet / other)",
      display_order: 7,
      questions: [
        {
          text: "How would you describe the smell: musty/moldy, sweet like maple syrup, gasoline, burning, or something else?",
          multi_select: false,
          options: [
            { label: "Musty/moldy", value: "musty" },
            { label: "Sweet like maple syrup", value: "sweet" },
            { label: "Gasoline", value: "gas" },
            { label: "Burning", value: "burning" },
            { label: "Something else", value: "other" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the smell strongest when you first turn the AC on, or after the AC has been running a while?",
          multi_select: false,
          options: [
            { label: "When first turned on", value: "first" },
            { label: "After running a while", value: "after" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the smell happen with the AC on, the heat on, or both?",
          multi_select: true,
          options: [
            { label: "AC on", value: "ac" },
            { label: "Heat on", value: "heat" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have the windows been fogging up at the same time the smell shows up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the cabin air filter been changed in the last year or two?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Did the smell start after the car sat unused for a while, or after a recent service?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell go away if you switch to recirculate, or get worse?",
          multi_select: false,
          options: [
            { label: "Goes away", value: "away" },
            { label: "Gets worse", value: "worse" },
            { label: "No change", value: "no_change" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "one_zone_works_but_another_doesnt",
      display_label: "One zone works but another doesn't",
      display_order: 8,
      questions: [
        {
          text: "Which side or zone is the problem: driver, passenger, or rear?",
          multi_select: true,
          options: [
            { label: "Driver", value: "driver" },
            { label: "Passenger", value: "passenger" },
            { label: "Rear", value: "rear" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is one side blowing cold while the other blows warm, or one warm while the other is cold?",
          multi_select: false,
          options: [
            { label: "One cold / other warm", value: "cold_warm" },
            { label: "One warm / other cold", value: "warm_cold" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the problem happen only with AC, only with heat, or both?",
          multi_select: false,
          options: [
            { label: "Only AC", value: "ac_only" },
            { label: "Only heat", value: "heat_only" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you heard any clicking or tapping sound from behind the dashboard when you change the temperature setting?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the temperature on the bad side change at all when you adjust its dial, or does it stay stuck no matter what?",
          multi_select: false,
          options: [
            { label: "Changes some", value: "some" },
            { label: "Stays stuck", value: "stuck" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the problem start after the car sat in very cold or very hot weather?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the airflow strength feel normal on the bad side, even if the temperature is wrong?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
  ],
};

// 4. LEAK
