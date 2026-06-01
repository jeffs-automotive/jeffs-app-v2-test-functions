import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, RECENT_NO_UNSURE, SUDDEN_GRADUAL, FREQUENCY_OPTS, BETTER_WORSE_SAME } from "../option-presets.ts";

export const performance: CanonicalCategory = {
  category: "performance",
  subcategories: [
    {
      slug: "hesitation_or_lag_when_accelerating",
      display_label: "Hesitation or lag when accelerating",
      display_order: 1,
      questions: [
        {
          text: "Does the hesitation happen when you first press the gas, or only when you push it hard for passing or merging?",
          multi_select: false,
          options: [
            { label: "When first pressing the gas", value: "initial" },
            { label: "Only under hard acceleration", value: "hard" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it happen in every gear, or only in a certain speed range?",
          multi_select: false,
          options: [
            { label: "Every gear", value: "every" },
            { label: "Certain speed range", value: "range" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the check engine light on or flashing when it happens?",
          multi_select: false,
          options: [
            { label: "Flashing", value: "flashing" },
            { label: "Solid on", value: "solid" },
            { label: "Off", value: "off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this start suddenly, or has it been getting worse over weeks or months?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Have you filled up at a different gas station recently or noticed it after a fuel-up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it ever feel like the car jerks, bucks, or stumbles when you push the pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the problem happen all the time or only sometimes?",
          multi_select: false,
          options: FREQUENCY_OPTS,
        },
      ],
    },
    {
      slug: "rough_idle_or_shaking_at_a_stop",
      display_label: "Rough idle or shaking at a stop",
      display_order: 2,
      questions: [
        {
          text: "Does the shaking happen only when you're stopped, or also when you're driving?",
          multi_select: false,
          options: [
            { label: "Only when stopped", value: "stopped" },
            { label: "Also when driving", value: "driving_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the shaking get better, worse, or go away when you shift into Neutral or Park?",
          multi_select: false,
          options: BETTER_WORSE_SAME,
        },
        {
          text: "Does turning on the A/C, heater, or defrost make the shaking worse?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the check engine light on, flashing, or has it come on recently?",
          multi_select: false,
          options: [
            { label: "Flashing", value: "flashing" },
            { label: "Solid on", value: "solid" },
            { label: "Off", value: "off" },
            { label: "Came on recently", value: "recent" },
          ],
        },
        {
          text: "Do you smell any gas fumes or rotten-egg smell from the exhaust when it's shaking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the RPM needle bounce up and down on its own while you're sitting at a light?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When did you last have spark plugs or a tune-up done?",
          multi_select: false,
          options: [
            { label: "Within the last year", value: "lt_1_year" },
            { label: "1-3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "stalling_at_idle_or_when_stopping",
      display_label: "Stalling at idle or when stopping",
      display_order: 3,
      questions: [
        {
          text: "Does the engine die right as you come to a stop, or after sitting still for a few seconds?",
          multi_select: false,
          options: [
            { label: "Right as I stop", value: "at_stop" },
            { label: "After sitting still a few seconds", value: "after_sitting" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it stall more often when the A/C, heater, or headlights are on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Will it restart right away after it stalls, or do you have to wait?",
          multi_select: false,
          options: [
            { label: "Restarts right away", value: "immediate" },
            { label: "Have to wait", value: "wait" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it stall when the engine is cold, after it warms up, or both?",
          multi_select: false,
          options: [
            { label: "Cold only", value: "cold" },
            { label: "After warm-up only", value: "warm" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the check engine light on when this happens?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed a rough or unstable idle leading up to the stall?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the stalling happen more in hot weather, cold weather, or no pattern?",
          multi_select: false,
          options: [
            { label: "Hot weather", value: "hot" },
            { label: "Cold weather", value: "cold" },
            { label: "No pattern", value: "no_pattern" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "stalling_while_driving_under_load",
      display_label: "Stalling while driving (under load)",
      display_order: 4,
      questions: [
        {
          text: "Does it cut out at highway speed, while going uphill, or only at slow speeds?",
          multi_select: true,
          options: [
            { label: "Highway speed", value: "highway" },
            { label: "Going uphill", value: "uphill" },
            { label: "Slow speeds", value: "slow" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it die suddenly with no warning, or does it sputter and lose power first?",
          multi_select: false,
          options: [
            { label: "Suddenly, no warning", value: "sudden" },
            { label: "Sputters first", value: "sputters" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "After it dies, does it crank back over right away, or do you have to wait several minutes?",
          multi_select: false,
          options: [
            { label: "Cranks right away", value: "immediate" },
            { label: "Have to wait several minutes", value: "wait" },
            { label: "Won't crank at all", value: "no_crank" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the dashboard go dark or do warning lights flash when it cuts out?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "How much fuel was in the tank when this happened?",
          multi_select: false,
          options: [
            { label: "Nearly full", value: "full" },
            { label: "About half", value: "half" },
            { label: "Below a quarter", value: "low" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the temperature gauge running hotter than normal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there any smoke, smell, or unusual noise right before it dies?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "hard_to_start_when_cold",
      display_label: "Hard to start when cold (after sitting overnight)",
      display_order: 5,
      questions: [
        {
          text: "Does it take several seconds of cranking before it finally fires up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Once it starts, does it run rough for the first minute or so before smoothing out?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is this only an issue when it's been cold outside, or does it happen any time it sits overnight?",
          multi_select: false,
          options: [
            { label: "Only when it's cold outside", value: "cold_only" },
            { label: "Anytime it sits overnight", value: "overnight" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did you have to jump-start it, or did the battery sound strong while cranking?",
          multi_select: false,
          options: [
            { label: "Had to jump-start", value: "jumped" },
            { label: "Battery sounded strong", value: "strong" },
            { label: "Battery sounded weak", value: "weak" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any black smoke or strong gas smell when it finally starts?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "About how long has it been doing this — days, weeks, or months?",
          multi_select: false,
          options: [
            { label: "Days", value: "days" },
            { label: "Weeks", value: "weeks" },
            { label: "Months", value: "months" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the check engine light stay on after it starts, or come on and go off?",
          multi_select: false,
          options: [
            { label: "Stays on", value: "stays" },
            { label: "Comes on and goes off", value: "intermittent" },
            { label: "Stays off", value: "off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "hard_to_start_when_hot",
      display_label: "Hard to start when hot (right after driving)",
      display_order: 6,
      questions: [
        {
          text: "Does it only happen when you stop for a short errand and try to restart, like at a gas station?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it crank fine but take a long time to actually catch and run?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed it after driving in hot weather or after sitting in traffic?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it start better if you press the gas pedal partway down while turning the key?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Once it does start, does it idle rough for a few seconds before smoothing out?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there any smell of raw gas around the engine when this happens?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it ever stall right after starting if you don't give it gas?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "low_power_or_wont_accelerate_normally",
      display_label: "Low power or won't accelerate normally",
      display_order: 7,
      questions: [
        {
          text: "Is the loss of power constant, or does it come and go?",
          multi_select: false,
          options: [
            { label: "Constant", value: "constant" },
            { label: "Comes and goes", value: "intermittent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the engine rev up high but the car doesn't pick up speed like it used to?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the check engine light flashing, solid, or off?",
          multi_select: false,
          options: [
            { label: "Flashing", value: "flashing" },
            { label: "Solid", value: "solid" },
            { label: "Off", value: "off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed a sudden drop in your gas mileage along with the power loss?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car feel like it's stuck in a lower gear or \"held back\" when you accelerate?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear any unusual sounds — hissing, popping, or a louder-than-normal exhaust?",
          multi_select: true,
          options: [
            { label: "Hissing", value: "hissing" },
            { label: "Popping", value: "popping" },
            { label: "Louder exhaust", value: "exhaust" },
            { label: "None of these", value: "none" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it happen more on hills, at highway speed, or all the time?",
          multi_select: true,
          options: [
            { label: "On hills", value: "hills" },
            { label: "At highway speed", value: "highway" },
            { label: "All the time", value: "all_time" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "surging_or_rpms_going_up_and_down",
      display_label: "Surging or RPMs going up and down on their own",
      display_order: 8,
      questions: [
        {
          text: "Does the surging happen at idle when you're stopped, or while you're driving at a steady speed?",
          multi_select: true,
          options: [
            { label: "At idle when stopped", value: "idle" },
            { label: "At steady driving speed", value: "driving" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the RPM needle visibly bounce up and down without you touching the pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it surge more when the engine is cold, after it warms up, or both?",
          multi_select: false,
          options: [
            { label: "When cold", value: "cold" },
            { label: "After warm-up", value: "warm" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does running the A/C or heat make the surging better or worse?",
          multi_select: false,
          options: BETTER_WORSE_SAME,
        },
        {
          text: "Is the check engine light on or has it flashed recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any recent work done on the throttle, intake, or air filter?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the car feel like it's lurching forward at low speeds even when your foot isn't on the gas?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "engine_misfire_or_bucking_feeling",
      display_label: "Engine misfire or bucking feeling",
      display_order: 9,
      questions: [
        {
          text: "Does it feel like the car is skipping, jerking, or kicking while you're driving?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the check engine light flashing when this happens? (Flashing is more serious than solid.)",
          multi_select: false,
          options: [
            { label: "Flashing", value: "flashing" },
            { label: "Solid on", value: "solid" },
            { label: "Off", value: "off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the misfire happen at certain speeds, under hard acceleration, or randomly?",
          multi_select: true,
          options: [
            { label: "Certain speeds", value: "speeds" },
            { label: "Under hard acceleration", value: "hard_accel" },
            { label: "Randomly", value: "random" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it get worse in rain, humidity, or wet weather?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the exhaust sound has changed — louder, popping, or uneven?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "How long has it been since the spark plugs were replaced?",
          multi_select: false,
          options: [
            { label: "Within the last year", value: "lt_1_year" },
            { label: "1-3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the misfire come and go, or is it constant once it starts?",
          multi_select: false,
          options: [
            { label: "Comes and goes", value: "intermittent" },
            { label: "Constant", value: "constant" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 8. PULLING
