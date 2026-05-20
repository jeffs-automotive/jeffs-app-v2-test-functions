/**
 * Canonical answer-option catalog for the customer-facing diagnostic wizard.
 *
 * Each question has a hand-tuned `multi_select` flag and `options` array that
 * matches the natural answer space of the question's text — Yes/No for
 * propositions, location chips for "front or rear / left or right",
 * speed-band chips for "at what speed", etc. The mapping was derived from
 * the source-of-truth markdown files at docs/chat-instructions/scheduler/templates/concerns/* (moved 2026-05-19 from docs/scheduler/concerns/).
 *
 * Used by the migration seeder to overwrite the legacy yes/no/sometimes
 * defaults written by earlier migrations.
 */

export interface CanonicalQuestion {
  text: string;
  multi_select: boolean;
  options: Array<{ label: string; value: string }>;
}

export interface CanonicalSubcategory {
  slug: string;
  display_label: string;
  display_order: number;
  questions: CanonicalQuestion[];
}

export interface CanonicalCategory {
  category: string;
  subcategories: CanonicalSubcategory[];
}

// Shared option presets to keep the file readable.

const YES_NO_UNSURE = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
  { label: "Not sure", value: "unsure" },
];

const YES_NO_UNCHECKED = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
  { label: "Haven't checked", value: "unchecked" },
];

const RECENT_NO_UNSURE = [
  { label: "Yes — recently", value: "recent" },
  { label: "No", value: "no" },
  { label: "Not sure", value: "unsure" },
];

const SUDDEN_GRADUAL = [
  { label: "Suddenly", value: "sudden" },
  { label: "Gradually over time", value: "gradual" },
  { label: "Not sure", value: "unsure" },
];

const SUDDEN_ALWAYS = [
  { label: "Suddenly", value: "sudden" },
  { label: "Always been there", value: "always" },
  { label: "Not sure", value: "unsure" },
];

const FREQUENCY_OPTS = [
  { label: "Every time", value: "every" },
  { label: "Sometimes", value: "sometimes" },
  { label: "Rarely", value: "rarely" },
  { label: "Not sure", value: "unsure" },
];

const BETTER_WORSE_SAME = [
  { label: "Better", value: "better" },
  { label: "Worse", value: "worse" },
  { label: "No change", value: "no_change" },
  { label: "Not sure", value: "unsure" },
];

const LOCATION_MULTI = [
  { label: "Front", value: "front" },
  { label: "Rear", value: "rear" },
  { label: "Left side", value: "left" },
  { label: "Right side", value: "right" },
  { label: "All four wheels", value: "all" },
  { label: "Not sure", value: "unsure" },
];

const SINGLE_TIRE = [
  { label: "Front-left", value: "front_left" },
  { label: "Front-right", value: "front_right" },
  { label: "Rear-left", value: "rear_left" },
  { label: "Rear-right", value: "rear_right" },
  { label: "More than one", value: "multiple" },
  { label: "Not sure", value: "unsure" },
];

const SPEED_BANDS = [
  { label: "Low speeds (under 30 mph)", value: "low" },
  { label: "Medium speeds (30-45 mph)", value: "medium" },
  { label: "Highway speeds (45+ mph)", value: "highway" },
  { label: "Any speed", value: "any" },
  { label: "Not sure", value: "unsure" },
];

const BATTERY_AGE = [
  { label: "Less than 2 years", value: "lt_2" },
  { label: "2 to 4 years", value: "2_to_4" },
  { label: "More than 4 years", value: "gt_4" },
  { label: "Not sure", value: "unsure" },
];

const FOG_ALL_TIME = [
  { label: "Only cold/rainy days", value: "cold_rainy" },
  { label: "All the time", value: "all_time" },
  { label: "Not sure", value: "unsure" },
];

// 1. BRAKES

const brakes: CanonicalCategory = {
  category: "brakes",
  subcategories: [
    {
      slug: "high_pitched_squealing",
      display_label: "High-pitched squealing",
      display_order: 1,
      questions: [
        {
          text: "Does it occur at high speeds, low speeds, or right before stopping?",
          multi_select: false,
          options: [
            { label: "High speeds", value: "high" },
            { label: "Low speeds", value: "low" },
            { label: "Right before stopping", value: "stopping" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it quiet down or get louder when pressing the pedal harder?",
          multi_select: false,
          options: [
            { label: "Quieter", value: "quieter" },
            { label: "Louder", value: "louder" },
            { label: "No change", value: "no_change" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the noise worse during the first few stops in the morning or does it get louder the longer you drive?",
          multi_select: false,
          options: [
            { label: "Worse first stops in the morning", value: "morning" },
            { label: "Louder the longer I drive", value: "longer" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does rain, high humidity, or morning dew affect the sound?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any brake work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the noise happen after the vehicle sits for a while and then goes away after driving?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear the noise coming from the front or rear of the vehicle? Left or right side?",
          multi_select: true,
          options: LOCATION_MULTI,
        },
      ],
    },
    {
      slug: "metallic_grinding",
      display_label: "Metallic grinding",
      display_order: 2,
      questions: [
        {
          text: "Does the grinding happen every single time you apply the brakes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear a scraping sound even when your foot is off the pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the sound feel like it is coming from the front or rear? Left or right side?",
          multi_select: true,
          options: LOCATION_MULTI,
        },
        {
          text: "Can you feel a harsh grinding sensation through the floor or pedal?",
          multi_select: true,
          options: [
            { label: "Floor", value: "floor" },
            { label: "Pedal", value: "pedal" },
            { label: "Neither", value: "neither" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this sound start suddenly, or build up over several weeks?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Do you feel safe driving the vehicle?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had brake work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "spongy_or_soft_pedal",
      display_label: "Spongy or soft pedal",
      display_order: 3,
      questions: [
        {
          text: "Does the brake pedal get firmer if you pump it rapidly three times?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Can you easily push the pedal all the way down to the carpet?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the vehicle take longer to start slowing down than it used to?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the brake fluid reservoir level dropping recently?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Has the brake system been opened or bled for service recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "pedal_sinks_to_floor",
      display_label: "Pedal sinks to floor",
      display_order: 4,
      questions: [
        {
          text: "Does the pedal creep down while holding pressure at a red light?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it sink faster if you press lightly or if you press firmly?",
          multi_select: false,
          options: [
            { label: "Pressing lightly", value: "lightly" },
            { label: "Pressing firmly", value: "firmly" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are there any visible fluid spots on your driveway or garage floor?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Are there any warning lights on the dash?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the pedal pop right back up instantly when you release your foot?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any brake work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "pulsating_or_vibrating_pedal",
      display_label: "Pulsating or vibrating pedal",
      display_order: 5,
      questions: [
        {
          text: "At what specific speed does the foot pedal vibration become noticeable?",
          multi_select: false,
          options: SPEED_BANDS,
        },
        {
          text: "Does the pulsation get worse the harder you press on the brakes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you feel the vibration in the steering wheel or in your seat?",
          multi_select: true,
          options: [
            { label: "Steering wheel", value: "steering" },
            { label: "Seat", value: "seat" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the pulsation worsen after driving down a long hill or mountain?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you feel the vibration all the time, when first driving or after driving for a while?",
          multi_select: false,
          options: [
            { label: "All the time", value: "all_time" },
            { label: "When first driving", value: "first" },
            { label: "After driving for a while", value: "after_while" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you had brake work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "hard_or_unresponsive_pedal",
      display_label: "Hard or unresponsive pedal",
      display_order: 6,
      questions: [
        {
          text: "Is the pedal stiff before you turn the engine key on in the morning?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the pedal drop slightly when you crank the engine over?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the pedal get harder to press the longer you drive the vehicle?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear any noises while you are braking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the engine idle rough or stumble when you press the brakes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had brake work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
  ],
};

// 2. ELECTRICAL

const electrical: CanonicalCategory = {
  category: "electrical",
  subcategories: [
    {
      slug: "wont_crank_just_clicks",
      display_label: "Won't crank / just clicks",
      display_order: 1,
      questions: [
        {
          text: "When you turn the key or push the button, do you hear a single loud click, rapid clicking like a machine gun, or no sound at all?",
          multi_select: false,
          options: [
            { label: "Single loud click", value: "single_click" },
            { label: "Rapid clicking", value: "rapid_clicking" },
            { label: "No sound at all", value: "no_sound" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do the dashboard lights and headlights come on when you turn the key, and if so, do they look normal or do they go dim when you try to start it?",
          multi_select: false,
          options: [
            { label: "Yes — they look normal", value: "normal" },
            { label: "Yes — they go dim", value: "dim" },
            { label: "No lights at all", value: "no_lights" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you tried jumping the car, and if you did, did it start right up after the jump?",
          multi_select: false,
          options: [
            { label: "Yes — started right up", value: "jumped_started" },
            { label: "Yes — but still wouldn't start", value: "jumped_failed" },
            { label: "Haven't tried", value: "not_tried" },
          ],
        },
        {
          text: "How old is the battery — less than 2 years, 2 to 4 years, more than 4 years, or you're not sure?",
          multi_select: false,
          options: BATTERY_AGE,
        },
        {
          text: "Has the car needed a jump-start recently, and if so, was it once or several times?",
          multi_select: false,
          options: [
            { label: "Once", value: "once" },
            { label: "Several times", value: "several" },
            { label: "No recent jumps", value: "no" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this happen suddenly with no warning, or had the car been getting harder to start over the last few days or weeks?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "Does it happen every time you try to start it, or does it sometimes start normally if you try again a few times?",
          multi_select: false,
          options: FREQUENCY_OPTS,
        },
      ],
    },
    {
      slug: "slow_crank_sluggish_start",
      display_label: "Slow crank / sluggish start",
      display_order: 2,
      questions: [
        {
          text: "When you turn the key, does the engine sound like it's turning over slowly or laboring before it finally starts?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the slow cranking worse in cold weather, hot weather, or about the same regardless of temperature?",
          multi_select: false,
          options: [
            { label: "Cold weather", value: "cold" },
            { label: "Hot weather", value: "hot" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is it worse first thing in the morning after sitting overnight, or just as bad after the car has been sitting only a few hours?",
          multi_select: false,
          options: [
            { label: "Worse in the morning", value: "morning" },
            { label: "Just as bad after a few hours", value: "few_hours" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "How old is the battery — less than 2 years, 2 to 4 years, more than 4 years, or you're not sure?",
          multi_select: false,
          options: BATTERY_AGE,
        },
        {
          text: "Has the battery been replaced or had any charging-system work done in the last year or two?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Do the headlights look dim when you're trying to start it, and do they brighten up once it finally fires?",
          multi_select: false,
          options: [
            { label: "Yes — dim, then brighten", value: "dim_then_bright" },
            { label: "Dim the whole time", value: "dim_always" },
            { label: "Look normal", value: "normal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "After it does start, does it run normally or does it idle rough for the first minute or two?",
          multi_select: false,
          options: [
            { label: "Runs normally", value: "normal" },
            { label: "Idles rough for a minute", value: "rough_idle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "battery_drains_overnight",
      display_label: "Battery drains overnight",
      display_order: 3,
      questions: [
        {
          text: "About how long can the car sit before the battery dies — overnight, a couple of days, or a week or more?",
          multi_select: false,
          options: [
            { label: "Overnight", value: "overnight" },
            { label: "A couple of days", value: "few_days" },
            { label: "A week or more", value: "week_plus" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Once you jump it or charge it, does the car start and run normally for the rest of the day?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there anything you've added to the car recently — like a dash cam, aftermarket stereo, remote starter, alarm, or trailer wiring?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When you walk up to the car after it's been sitting, do you ever notice an interior light, glove box light, or trunk light still on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the radio, headlights, or wipers ever staying on for a moment after you've turned the key off and shut the door?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "How old is the battery, and has it been replaced once already because of this same dying-overnight problem?",
          multi_select: false,
          options: [
            { label: "Less than 2 years — already replaced for this", value: "lt_2_replaced" },
            { label: "Less than 2 years — original", value: "lt_2_original" },
            { label: "2 to 4 years", value: "2_to_4" },
            { label: "More than 4 years", value: "gt_4" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it die faster in hot weather, cold weather, or does the weather not seem to matter?",
          multi_select: false,
          options: [
            { label: "Hot weather", value: "hot" },
            { label: "Cold weather", value: "cold" },
            { label: "Weather doesn't matter", value: "no_pattern" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "dim_or_flickering_lights",
      display_label: "Dim or flickering lights",
      display_order: 4,
      questions: [
        {
          text: "Are the headlights and dashboard lights dim, flickering, or pulsing brighter and dimmer while you're driving?",
          multi_select: false,
          options: [
            { label: "Dim", value: "dim" },
            { label: "Flickering", value: "flickering" },
            { label: "Pulsing brighter and dimmer", value: "pulsing" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do the lights change brightness when you rev the engine or when you speed up on the highway?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there a battery-shaped warning light or a \"CHARGE\" light on the dashboard right now?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are the interior lights and radio acting normal, or do they also dim and flicker along with the headlights?",
          multi_select: false,
          options: [
            { label: "Acting normal", value: "normal" },
            { label: "Also dim and flicker", value: "also_dim" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any burning smell, like hot rubber or hot wires, coming from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did you hear any squealing or whining belt noise from under the hood before the dimming started?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had a new battery or alternator installed recently, and if so, did this problem start before or after that work?",
          multi_select: false,
          options: [
            { label: "Started before that work", value: "before" },
            { label: "Started after that work", value: "after" },
            { label: "No recent battery/alternator work", value: "no_work" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "accessory_doesnt_work",
      display_label: "An accessory doesn't work (window, radio, dome light, etc.)",
      display_order: 5,
      questions: [
        {
          text: "Which specific thing isn't working — for example one window, all the windows, the radio, the dome light, the wipers, or the power locks?",
          multi_select: true,
          options: [
            { label: "One window", value: "one_window" },
            { label: "All windows", value: "all_windows" },
            { label: "Radio", value: "radio" },
            { label: "Dome light", value: "dome_light" },
            { label: "Wipers", value: "wipers" },
            { label: "Power locks", value: "locks" },
            { label: "Something else", value: "other" },
          ],
        },
        {
          text: "If it's a window or lock, does only one of them not work, or do several of them on the same side or all over the car not work?",
          multi_select: false,
          options: [
            { label: "Only one", value: "one" },
            { label: "Several on the same side", value: "side" },
            { label: "All over the car", value: "all" },
            { label: "Not applicable", value: "na" },
          ],
        },
        {
          text: "Did it stop working all at once, or did it act up for a while — working sometimes, not other times — before completely quitting?",
          multi_select: false,
          options: [
            { label: "Stopped all at once", value: "sudden" },
            { label: "Acted up for a while first", value: "intermittent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did anything happen right before it stopped — like a fender bender, a sound system install, a car wash, or spilling a drink inside?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When you try to use it, do you hear any sound at all — a click, a hum, a buzz — or is it completely silent and dead?",
          multi_select: false,
          options: [
            { label: "Click", value: "click" },
            { label: "Hum", value: "hum" },
            { label: "Buzz", value: "buzz" },
            { label: "Completely silent", value: "silent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are any other electrical things in the car acting strange right now, even slightly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anyone checked the fuses, and if so, did they find a blown one or did they all look okay?",
          multi_select: false,
          options: [
            { label: "Yes — found a blown fuse", value: "blown" },
            { label: "Yes — all looked okay", value: "okay" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
      ],
    },
    {
      slug: "multiple_random_electrical_glitches",
      display_label: "Multiple random electrical glitches",
      display_order: 6,
      questions: [
        {
          text: "Can you list everything that's been acting up — for example dash gauges, radio resetting, warning lights coming on for no reason, locks cycling on their own?",
          multi_select: true,
          options: [
            { label: "Dash gauges", value: "gauges" },
            { label: "Radio resetting", value: "radio" },
            { label: "Warning lights for no reason", value: "warning_lights" },
            { label: "Locks cycling on their own", value: "locks" },
            { label: "Something else", value: "other" },
          ],
        },
        {
          text: "Do the glitches happen at the same time as each other, or do different things act up at different times?",
          multi_select: false,
          options: [
            { label: "Same time", value: "same_time" },
            { label: "Different times", value: "different_times" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is it worse over bumps and rough roads, or does it happen just as much on smooth pavement?",
          multi_select: false,
          options: [
            { label: "Worse over bumps", value: "bumps" },
            { label: "Same on smooth pavement", value: "smooth" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it get worse in rainy weather, after a car wash, or after a hot/humid day?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the car been in a flood, had a leak, or been driven through deep water at any point?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anyone done any electrical work on the car recently — battery, alternator, stereo, aftermarket lights, remote starter?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Have you noticed any check-engine light, ABS light, traction-control light, or airbag light coming on along with the other problems?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "car_died_while_driving_electrical",
      display_label: "Car died while driving (electrical)",
      display_order: 7,
      questions: [
        {
          text: "Right before the car died, did the dashboard lights and headlights start getting dim or flicker?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the engine sputter and lose power gradually, or did everything just shut off all at once like flipping a switch?",
          multi_select: false,
          options: [
            { label: "Sputtered and lost power gradually", value: "gradual" },
            { label: "Shut off all at once", value: "sudden" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Was the battery warning light or \"CHARGE\" light on the dashboard before it died?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did you hear any squealing belt noise, grinding, or knocking from under the hood beforehand?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "After it died, did the starter try to crank when you turned the key, or did you get nothing — no lights, no clicks, no sound?",
          multi_select: false,
          options: [
            { label: "Starter tried to crank", value: "cranked" },
            { label: "Nothing at all", value: "nothing" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Were you using a lot of accessories at the time — like the AC on high, headlights, defroster, heated seats — or driving with only a few things on?",
          multi_select: false,
          options: [
            { label: "A lot of accessories", value: "many" },
            { label: "Only a few things on", value: "few" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the car been jump-started recently, and if so, did this happen during that same drive or a day or two later?",
          multi_select: false,
          options: [
            { label: "Same drive as the jump", value: "same_drive" },
            { label: "A day or two later", value: "days_later" },
            { label: "No recent jump", value: "no" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 3. HVAC

const hvac: CanonicalCategory = {
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

const leak: CanonicalCategory = {
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

const noise: CanonicalCategory = {
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

const other: CanonicalCategory = {
  category: "other",
  subcategories: [
    {
      slug: "multiple_symptoms_not_sure_what_category",
      display_label: "Multiple symptoms / not sure what category",
      display_order: 1,
      questions: [
        {
          text: "Which problem do you notice first when you start driving — or do they all show up at the same time?",
          multi_select: false,
          options: [
            { label: "One problem first", value: "one_first" },
            { label: "All at the same time", value: "all_at_once" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are the issues happening together every time, or does each one come and go on its own?",
          multi_select: false,
          options: [
            { label: "Together every time", value: "together" },
            { label: "Each on its own", value: "separate" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did everything start around the same time, or did one problem show up first and the others followed later?",
          multi_select: false,
          options: [
            { label: "Same time", value: "same" },
            { label: "One first, others later", value: "staggered" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any pattern — like it only happens when it rains, when the car is cold, when you turn, or at certain speeds?",
          multi_select: true,
          options: [
            { label: "When it rains", value: "rain" },
            { label: "When the car is cold", value: "cold" },
            { label: "When turning", value: "turning" },
            { label: "At certain speeds", value: "speed" },
            { label: "No pattern", value: "no_pattern" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is there one symptom that worries you the most, or feels the most urgent?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anything changed recently — like a long road trip, towing something, an oil change, or new tires?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any dashboard warning lights come on, even briefly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "after_a_recent_accident_or_impact",
      display_label: "After a recent accident or impact",
      display_order: 2,
      questions: [
        {
          text: "When did the accident or impact happen, and have you driven the car since?",
          multi_select: false,
          options: [
            { label: "Today — haven't driven since", value: "today_no_drive" },
            { label: "Today — have driven since", value: "today_drove" },
            { label: "In the last week", value: "last_week" },
            { label: "More than a week ago", value: "older" },
          ],
        },
        {
          text: "Was it a collision with another vehicle, a curb hit, a pothole, or running over something in the road?",
          multi_select: false,
          options: [
            { label: "Collision with another vehicle", value: "collision" },
            { label: "Curb hit", value: "curb" },
            { label: "Pothole", value: "pothole" },
            { label: "Ran over debris", value: "debris" },
            { label: "Something else", value: "other" },
          ],
        },
        {
          text: "Did any airbags deploy, or did any warning lights come on after the impact?",
          multi_select: false,
          options: [
            { label: "Airbags deployed", value: "airbags" },
            { label: "Warning lights came on", value: "lights" },
            { label: "Both", value: "both" },
            { label: "Neither", value: "neither" },
          ],
        },
        {
          text: "Are you filing an insurance claim, or is this something you're handling on your own?",
          multi_select: false,
          options: [
            { label: "Filing an insurance claim", value: "insurance" },
            { label: "Handling on my own", value: "self_pay" },
            { label: "Not sure yet", value: "unsure" },
          ],
        },
        {
          text: "Does the steering feel different — pulling to one side, off-center, or shaky?",
          multi_select: true,
          options: [
            { label: "Pulling to one side", value: "pull" },
            { label: "Off-center", value: "off_center" },
            { label: "Shaky", value: "shaky" },
            { label: "Feels normal", value: "normal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are you seeing any new fluid drips on the ground where you park?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the car feel like it's sitting level, or does one corner look lower than the others?",
          multi_select: false,
          options: [
            { label: "Sitting level", value: "level" },
            { label: "One corner lower", value: "uneven" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "after_recent_service_or_repair_work",
      display_label: "After recent service or repair work",
      display_order: 3,
      questions: [
        {
          text: "Where was the recent work done — at our shop, a dealership, or somewhere else?",
          multi_select: false,
          options: [
            { label: "At your shop", value: "this_shop" },
            { label: "Dealership", value: "dealer" },
            { label: "Another shop", value: "other_shop" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "About how long ago was that service, and do you have the receipt or invoice handy?",
          multi_select: false,
          options: [
            { label: "Within a week — have receipt", value: "lt_week_with" },
            { label: "Within a week — no receipt", value: "lt_week_without" },
            { label: "1-4 weeks ago", value: "1_to_4_weeks" },
            { label: "More than a month ago", value: "gt_month" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "What was the original reason you took it in — and is this the same problem coming back, or something new?",
          multi_select: false,
          options: [
            { label: "Same problem coming back", value: "same" },
            { label: "Something new", value: "new" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the issue show up right after picking up the car, or did it appear days or weeks later?",
          multi_select: false,
          options: [
            { label: "Right after pickup", value: "immediately" },
            { label: "Days later", value: "days" },
            { label: "Weeks later", value: "weeks" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are any parts or labor still under warranty from that previous shop?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the car been driven much since the work was done?",
          multi_select: false,
          options: [
            { label: "Very little", value: "little" },
            { label: "A lot", value: "lot" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the other shop mention anything they recommended but didn't end up doing?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "safety_concern_dont_feel_safe_driving_it",
      display_label: "Safety concern — don't feel safe driving it",
      display_order: 4,
      questions: [
        {
          text: "Are you currently somewhere safe, like home or a parking lot, or are you stranded on the road?",
          multi_select: false,
          options: [
            { label: "Somewhere safe", value: "safe" },
            { label: "Stranded on the road", value: "stranded" },
          ],
        },
        {
          text: "Is the car drivable at all, or is it not starting or not moving?",
          multi_select: false,
          options: [
            { label: "Drivable", value: "drivable" },
            { label: "Won't start", value: "no_start" },
            { label: "Won't move", value: "no_move" },
          ],
        },
        {
          text: "Are you seeing smoke, steam, or smelling something burning?",
          multi_select: true,
          options: [
            { label: "Smoke", value: "smoke" },
            { label: "Steam", value: "steam" },
            { label: "Burning smell", value: "burning" },
            { label: "None of these", value: "none" },
          ],
        },
        {
          text: "Are the brakes working normally, or do they feel soft, low, or like they're not stopping the car?",
          multi_select: false,
          options: [
            { label: "Working normally", value: "normal" },
            { label: "Feel soft / low", value: "soft" },
            { label: "Not stopping the car", value: "not_stopping" },
          ],
        },
        {
          text: "Is the steering working normally, or does it feel stiff, loose, or hard to control?",
          multi_select: false,
          options: [
            { label: "Working normally", value: "normal" },
            { label: "Stiff", value: "stiff" },
            { label: "Loose", value: "loose" },
            { label: "Hard to control", value: "hard" },
          ],
        },
        {
          text: "Is there a flashing warning light on the dashboard right now, like a flashing check engine or red temperature light?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Would you feel comfortable driving it slowly to the shop, or would you rather have it towed in?",
          multi_select: false,
          options: [
            { label: "Drive it slowly", value: "drive" },
            { label: "Tow it in", value: "tow" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "general_check_up_or_pre_trip_inspection",
      display_label: "General check-up or pre-trip inspection",
      display_order: 5,
      questions: [
        {
          text: "Are you preparing for a long road trip, or is this more of a routine peace-of-mind check?",
          multi_select: false,
          options: [
            { label: "Road trip prep", value: "trip" },
            { label: "Routine check", value: "routine" },
          ],
        },
        {
          text: "About when was the last time the car had any maintenance done on it?",
          multi_select: false,
          options: [
            { label: "In the last 3 months", value: "lt_3_months" },
            { label: "3-12 months ago", value: "3_to_12" },
            { label: "Over a year ago", value: "gt_year" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are there any small things you've noticed but haven't worried about — like a quiet noise or a soft feel?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "About how many miles are on the car right now?",
          multi_select: false,
          options: [
            { label: "Under 50,000", value: "lt_50k" },
            { label: "50,000-100,000", value: "50_to_100k" },
            { label: "100,000-150,000", value: "100_to_150k" },
            { label: "Over 150,000", value: "gt_150k" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you have any service records or a maintenance schedule from the manufacturer you'd like us to follow?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are there any specific areas you want us to focus on, like brakes, tires, or fluids?",
          multi_select: true,
          options: [
            { label: "Brakes", value: "brakes" },
            { label: "Tires", value: "tires" },
            { label: "Fluids", value: "fluids" },
            { label: "Engine", value: "engine" },
            { label: "Suspension", value: "suspension" },
            { label: "Whole car", value: "whole_car" },
          ],
        },
        {
          text: "Is there a date you need the car ready by?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "car_has_been_sitting_unused_for_a_long_time",
      display_label: "Car has been sitting unused for a long time",
      display_order: 6,
      questions: [
        {
          text: "About how long has the car been sitting without being driven?",
          multi_select: false,
          options: [
            { label: "A few weeks", value: "weeks" },
            { label: "A few months", value: "months" },
            { label: "Over a year", value: "year_plus" },
            { label: "Several years", value: "years" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Was it parked in a garage, under a cover, or outside in the weather?",
          multi_select: false,
          options: [
            { label: "Garage", value: "garage" },
            { label: "Under a cover", value: "cover" },
            { label: "Outside in the weather", value: "outside" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did you take any steps before parking it — like adding fuel stabilizer or disconnecting the battery?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you tried to start it recently, and if so, did it start up or struggle?",
          multi_select: false,
          options: [
            { label: "Started up fine", value: "started" },
            { label: "Struggled to start", value: "struggled" },
            { label: "Wouldn't start", value: "no_start" },
            { label: "Haven't tried", value: "not_tried" },
          ],
        },
        {
          text: "Is the car a hybrid or electric vehicle?",
          multi_select: false,
          options: [
            { label: "Hybrid", value: "hybrid" },
            { label: "Electric", value: "ev" },
            { label: "Gasoline / diesel", value: "ice" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any leaks, stains, or puddles where it's been parked?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Do you want it picked up by a tow truck, or have you been able to get it running enough to drive in?",
          multi_select: false,
          options: [
            { label: "Pick up by tow", value: "tow" },
            { label: "Can drive in", value: "drive" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 7. PERFORMANCE

const performance: CanonicalCategory = {
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

const pulling: CanonicalCategory = {
  category: "pulling",
  subcategories: [
    {
      slug: "pulling_only_when_braking",
      display_label: "Pulling only when braking",
      display_order: 1,
      questions: [
        {
          text: "Does the pulling only happen when you press the brake pedal, or also when cruising?",
          multi_select: false,
          options: [
            { label: "Only when braking", value: "braking_only" },
            { label: "Also when cruising", value: "cruising_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it pull harder to one side the harder you press the brakes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any brake work done recently, like new pads, rotors, or a caliper job?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "After driving for a while, does one wheel feel hotter than the others when you stand near it?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Do you smell anything burning or notice any smoke after a longer drive?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering wheel jerk in your hands the moment you start braking, or does the pull build up gradually?",
          multi_select: false,
          options: [
            { label: "Jerks immediately", value: "immediate" },
            { label: "Builds up gradually", value: "gradual" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it pull the same direction every single time you brake, or does the direction vary?",
          multi_select: false,
          options: [
            { label: "Same direction every time", value: "same" },
            { label: "Direction varies", value: "varies" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "steady_drift_while_cruising",
      display_label: "Steady drift while cruising",
      display_order: 2,
      questions: [
        {
          text: "Does the car drift the same direction the entire time you're driving straight on the highway?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When was the last time you had the wheels aligned or had any steering or suspension work done?",
          multi_select: false,
          options: [
            { label: "In the last year", value: "lt_1_year" },
            { label: "1-3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you bumped a curb, hit a deep pothole, or had any accident even a small one in the last few months?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you have to hold the steering wheel slightly off-center to make the car go straight?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you checked the air pressure in all four tires recently, and are they all roughly the same?",
          multi_select: false,
          options: [
            { label: "Yes — all roughly the same", value: "same" },
            { label: "Yes — uneven", value: "uneven" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "Have any of the tires been replaced or rotated in the last few weeks?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the car drift even when you let go of the wheel briefly on a flat empty parking lot?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "pulling_only_during_acceleration",
      display_label: "Pulling only during acceleration",
      display_order: 3,
      questions: [
        {
          text: "Does the car only pull when you step on the gas hard, like merging onto the highway or passing?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering wheel tug or twist in your hands when you accelerate firmly?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car straighten back out as soon as you ease off the gas?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it pull the opposite direction when you let off the gas or slow down?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is this a front-wheel-drive car, and has it always done this since you bought it, or did it start recently?",
          multi_select: false,
          options: [
            { label: "FWD — always done this", value: "fwd_always" },
            { label: "FWD — started recently", value: "fwd_recent" },
            { label: "Not FWD / not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you had any work done on the engine mounts, axles, or CV joints recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does it pull more when the road is wet or when one wheel is on a different surface than the other?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "drift_that_follows_the_roads_slope",
      display_label: "Drift that follows the road's slope",
      display_order: 4,
      questions: [
        {
          text: "When you drive on a perfectly flat parking lot with no slope, does the car still pull or does it go straight?",
          multi_select: false,
          options: [
            { label: "Still pulls", value: "pulls" },
            { label: "Goes straight", value: "straight" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the pull only show up on certain roads or in certain lanes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the direction of the pull change depending on which lane you're in or which road you're on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you find that you're constantly making small steering corrections to stay in your lane?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anyone else driven the car and noticed the same drift, or is it something only you feel?",
          multi_select: false,
          options: [
            { label: "Others noticed it too", value: "others" },
            { label: "Only I feel it", value: "just_me" },
            { label: "Nobody else has driven it", value: "no_one" },
          ],
        },
        {
          text: "Did the drift start suddenly or has it always been there since you got the car?",
          multi_select: false,
          options: SUDDEN_ALWAYS,
        },
        {
          text: "When you cross a bridge or get on a road that's tilted the other direction, does the pull reverse?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "pull_that_started_after_recent_tire_or_service_work",
      display_label: "Pull that started after recent tire or service work",
      display_order: 5,
      questions: [
        {
          text: "Did the pulling start right after a tire rotation, new tire installation, or wheel alignment?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "About how many miles or days passed between the service and the start of the pulling?",
          multi_select: false,
          options: [
            { label: "Immediately", value: "immediate" },
            { label: "Within a few days", value: "days" },
            { label: "Within a week or two", value: "weeks" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the shop replace one tire by itself, or were they all replaced together?",
          multi_select: false,
          options: [
            { label: "One tire only", value: "one" },
            { label: "Pair (front or rear)", value: "pair" },
            { label: "All four", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the pull get more noticeable the faster you drive, especially over 45 or 50 miles per hour?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Was the car pulling before the service, just in a different direction or to a different degree?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the shop mention any other concerns or recommend follow-up work at the same visit?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you taken the car back to the shop to have them re-check, and what did they say?",
          multi_select: false,
          options: [
            { label: "Yes — they found something", value: "yes_found" },
            { label: "Yes — they said nothing's wrong", value: "yes_nothing" },
            { label: "Haven't taken it back", value: "not_back" },
          ],
        },
      ],
    },
    {
      slug: "wandering_or_drifting_in_both_directions",
      display_label: "Wandering or drifting in both directions",
      display_order: 6,
      questions: [
        {
          text: "Does the car wander back and forth on its own, instead of pulling steady to one side?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering feel loose, like there's slack or play before the wheels respond?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear any clunking, knocking, or popping noises from the front end when you go over bumps?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car feel worse and harder to control when the road is rough or uneven?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any tires wearing unevenly, especially on the inside or outside edges?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the steering wheel sit straight when the car is going straight, or is it tilted off-center?",
          multi_select: false,
          options: [
            { label: "Sits straight", value: "straight" },
            { label: "Tilted off-center", value: "off_center" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the wandering get worse at highway speeds or stay about the same at all speeds?",
          multi_select: false,
          options: [
            { label: "Worse at highway speed", value: "highway" },
            { label: "Same at all speeds", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
  ],
};

// 9. SMELL

const smell: CanonicalCategory = {
  category: "smell",
  subcategories: [
    {
      slug: "sweet_smell_maple_syrup_antifreeze",
      display_label: "Sweet smell (maple syrup / antifreeze)",
      display_order: 1,
      questions: [
        {
          text: "Do you smell it more when the heater or defroster is running?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smell stronger inside the cabin or outside under the hood?",
          multi_select: false,
          options: [
            { label: "Inside the cabin", value: "cabin" },
            { label: "Outside / under the hood", value: "hood" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any damp spots or wet patches on the passenger-side floor or carpet?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the windshield fog up on the inside even when the weather is dry?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had to add coolant or antifreeze to the vehicle recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the smell come and go, or is it there every time you drive?",
          multi_select: false,
          options: [
            { label: "Every time I drive", value: "every" },
            { label: "Comes and goes", value: "intermittent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you see any green, orange, or pink fluid leaking under the car when it sits?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "burnt_oil_smell",
      display_label: "Burnt oil smell",
      display_order: 2,
      questions: [
        {
          text: "Do you smell it most when the engine has been running hard or after a long drive?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell come from under the hood, from underneath the car, or through the vents?",
          multi_select: false,
          options: [
            { label: "Under the hood", value: "hood" },
            { label: "Underneath the car", value: "underneath" },
            { label: "Through the vents", value: "vents" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you seen any blue or gray smoke coming from the back of the car or from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed oil drops or oil spots on the ground where you park?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Has the oil light on the dash come on, or have you had to top off the oil between changes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell get stronger right after you turn the engine off and walk away?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any recent oil changes or engine work done?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
      ],
    },
    {
      slug: "gasoline_fuel_smell",
      display_label: "Gasoline / fuel smell",
      display_order: 3,
      questions: [
        {
          text: "Do you smell it most right after starting the car, while driving, or after parking?",
          multi_select: true,
          options: [
            { label: "Right after starting", value: "starting" },
            { label: "While driving", value: "driving" },
            { label: "After parking", value: "parked" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the smell stronger inside the cabin or outside near the back of the car?",
          multi_select: false,
          options: [
            { label: "Inside the cabin", value: "cabin" },
            { label: "Outside near the back", value: "rear" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any wet spots or puddles under the vehicle where it sits?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Did you recently fill up the tank, and did the pump click off normally?",
          multi_select: false,
          options: [
            { label: "Yes — clicked off normally", value: "normal" },
            { label: "Yes — kept clicking / overflow", value: "overflow" },
            { label: "No recent fill-up", value: "no_fillup" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is your gas cap on tight, and does it click when you close it?",
          multi_select: false,
          options: [
            { label: "Yes — clicks tight", value: "tight" },
            { label: "Loose or doesn't click", value: "loose" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "Has the check-engine light come on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell get worse when you're driving uphill, accelerating hard, or sitting at idle?",
          multi_select: true,
          options: [
            { label: "Uphill", value: "uphill" },
            { label: "Accelerating hard", value: "accel" },
            { label: "At idle", value: "idle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "rotten_egg_sulfur_smell",
      display_label: "Rotten egg / sulfur smell",
      display_order: 4,
      questions: [
        {
          text: "Do you smell it mostly from the tailpipe area, or is it inside the cabin too?",
          multi_select: false,
          options: [
            { label: "Tailpipe area only", value: "tailpipe" },
            { label: "Inside the cabin too", value: "cabin_too" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it happen more after hard driving or sitting in traffic for a while?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the check-engine light come on or been on recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the car running rough, hesitating, or losing power when you smell it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the smell more after filling up at a particular gas station or with a different brand of fuel?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any work done on the exhaust, catalytic converter, or emissions system?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Is the smell present right at startup, or only once the engine has warmed up?",
          multi_select: false,
          options: [
            { label: "Right at startup", value: "startup" },
            { label: "Only after warm-up", value: "warm" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "burning_electrical_plastic_smell",
      display_label: "Burning electrical / plastic smell",
      display_order: 5,
      questions: [
        {
          text: "Have you noticed any flickering lights, blown fuses, or dashboard warnings around the same time?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell get worse when you turn on the heater, AC, or fan?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smell coming from the dashboard area, the vents, or under the hood?",
          multi_select: false,
          options: [
            { label: "Dashboard area", value: "dash" },
            { label: "Vents", value: "vents" },
            { label: "Under the hood", value: "hood" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have any electrical accessories or aftermarket parts been installed recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the smell come on when you use a specific feature like the radio, seat warmers, or power windows?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you seen any smoke or haze inside the cabin?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell stay even after the car is turned off and cooled down?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "burning_rubber_hot_brake_smell",
      display_label: "Burning rubber / hot brake smell",
      display_order: 6,
      questions: [
        {
          text: "Do you smell it more after stopping the car, especially after coming down a hill or heavy braking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smell coming from one specific wheel or all four?",
          multi_select: true,
          options: [
            { label: "Front-left", value: "front_left" },
            { label: "Front-right", value: "front_right" },
            { label: "Rear-left", value: "rear_left" },
            { label: "Rear-right", value: "rear_right" },
            { label: "All four", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the parking brake release fully, and have you been able to confirm it's all the way off?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Have you noticed any squealing, grinding, or dragging feeling from the brakes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell happen after long highway drives even when you haven't braked much?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you seen any smoke or haze coming from a wheel area or from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering feel heavier or different when the smell is present?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "musty_mildew_smell_from_vents",
      display_label: "Musty / mildew smell from vents",
      display_order: 7,
      questions: [
        {
          text: "Does the smell only come through the vents when you turn on the AC or heater?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smell strongest in the first few seconds after you turn the fan on, then fade?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smell go away when you switch to outside-air mode versus recirculate?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any water dripping under the dashboard onto your feet?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "When was the cabin air filter last changed, if you know?",
          multi_select: false,
          options: [
            { label: "Within the last year", value: "lt_1_year" },
            { label: "1-3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the car parked outside often, or does it sit unused for long stretches?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have the carpets or seats been wet recently from a spill, leak, or open window in the rain?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "exhaust_fumes_inside_the_cabin",
      display_label: "Exhaust fumes inside the cabin",
      display_order: 8,
      questions: [
        {
          text: "Do you smell the exhaust more when the windows are up, or only with a window cracked open?",
          multi_select: false,
          options: [
            { label: "Windows up", value: "up" },
            { label: "Window cracked open", value: "cracked" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the smell get worse when you're stopped at a light versus when you're driving?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it come on stronger when the heater or fan is running, especially on recirculate mode?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed the car running louder than normal, like a rumble or hissing sound?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you felt lightheaded, dizzy, drowsy, or had a headache while driving?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anyone done recent work on the exhaust, muffler, or undercarriage?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Is the rear hatch, trunk seal, or any window seal damaged or leaking air?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
  ],
};

// 10. SMOKE

const smoke: CanonicalCategory = {
  category: "smoke",
  subcategories: [
    {
      slug: "white_smoke_from_tailpipe",
      display_label: "White smoke from tailpipe",
      display_order: 1,
      questions: [
        {
          text: "Does the smoke only appear for the first minute or two after starting up cold, then disappear once the engine warms up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it keep happening even after you've been driving for ten or fifteen minutes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smoke have a sweet or syrupy smell to it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had to add coolant or top off the radiator recently, or noticed the coolant level dropping?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Has the engine been running hotter than normal or has the temperature gauge crept up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smoke thin and wispy, or thick and heavy like a cloud?",
          multi_select: false,
          options: [
            { label: "Thin and wispy", value: "wispy" },
            { label: "Thick and heavy", value: "heavy" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any milky or frothy stuff on the underside of the oil filler cap?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "blue_or_gray_smoke_from_tailpipe",
      display_label: "Blue or gray smoke from tailpipe",
      display_order: 2,
      questions: [
        {
          text: "Does the smoke puff out mainly when you first start the car after it's been sitting overnight?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it show up when you press the gas hard, like accelerating onto a highway?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it appear when you're slowing down or coasting down a hill with your foot off the gas?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you been adding oil between oil changes, and if so, how often?",
          multi_select: false,
          options: [
            { label: "Not adding oil", value: "none" },
            { label: "Every couple months", value: "occasional" },
            { label: "Every few weeks", value: "frequent" },
            { label: "Every week or more", value: "very_frequent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the smoke smell more like burning oil than anything sweet or like raw fuel?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there a turbocharger on the vehicle that you know of, and has it been making any whining or whistling noises?",
          multi_select: false,
          options: [
            { label: "Yes — turbo with noises", value: "turbo_noisy" },
            { label: "Yes — turbo, no noises", value: "turbo_quiet" },
            { label: "No turbo", value: "no_turbo" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any oily film or buildup around the tailpipe tip when you wipe a finger in it?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "black_smoke_from_tailpipe",
      display_label: "Black smoke from tailpipe",
      display_order: 3,
      questions: [
        {
          text: "Does the black smoke puff out when you stomp on the gas, or is it there all the time?",
          multi_select: false,
          options: [
            { label: "When stomping on the gas", value: "accel" },
            { label: "All the time", value: "all_time" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the vehicle a diesel, or does it run on regular gasoline?",
          multi_select: false,
          options: [
            { label: "Diesel", value: "diesel" },
            { label: "Gasoline", value: "gas" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the fuel mileage dropping recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the engine seem to hesitate, surge, or run rough?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When was the last time the air filter was changed, if you remember?",
          multi_select: false,
          options: [
            { label: "Within the last year", value: "lt_1_year" },
            { label: "1-3 years ago", value: "1_to_3" },
            { label: "More than 3 years ago", value: "gt_3" },
            { label: "Never / not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the check engine light on, and does it stay on or flash?",
          multi_select: false,
          options: [
            { label: "Stays on solid", value: "solid" },
            { label: "Flashes", value: "flashing" },
            { label: "Off", value: "off" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you smell strong raw fuel along with the smoke, almost like gasoline or diesel fumes?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "smoke_from_under_the_hood",
      display_label: "Smoke from under the hood",
      display_order: 4,
      questions: [
        {
          text: "Does the smoke have a sweet smell, a burnt-oil smell, or more of a plastic or electrical burn smell?",
          multi_select: false,
          options: [
            { label: "Sweet", value: "sweet" },
            { label: "Burnt oil", value: "oil" },
            { label: "Plastic / electrical", value: "electrical" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the temperature gauge climb into the red or did a hot-engine warning come on before you saw smoke?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any puddles, drips, or wet spots under the car after parking?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the smoke seem to be coming from one specific spot, or is it billowing out from all around the engine?",
          multi_select: false,
          options: [
            { label: "One specific spot", value: "specific" },
            { label: "All around the engine", value: "all_around" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the smoke start right after a recent oil change or other work done on the vehicle?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smoke only showing up after you've been driving for a while, or does it appear right away on startup?",
          multi_select: false,
          options: [
            { label: "After driving a while", value: "after_driving" },
            { label: "Right at startup", value: "startup" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did you hear any popping, hissing, or boiling sounds along with the smoke?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "smoke_or_burning_smell_from_a_wheel",
      display_label: "Smoke or burning smell from a wheel",
      display_order: 5,
      questions: [
        {
          text: "Is the smoke coming from one specific wheel, or do all four wheels look hot?",
          multi_select: true,
          options: [
            { label: "Front-left", value: "front_left" },
            { label: "Front-right", value: "front_right" },
            { label: "Rear-left", value: "rear_left" },
            { label: "Rear-right", value: "rear_right" },
            { label: "All four", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the vehicle pull to one side when you're driving straight on a flat road?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "After a drive, does one wheel feel much hotter than the others when you hold a hand near it (without touching)?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Did you maybe leave the parking brake on, even partly, during your last drive?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have the brakes felt soft, grabby, or like they're dragging when you let off the pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the smoke smell more like hot metal and burning brake material, or more like burning rubber from a tire?",
          multi_select: false,
          options: [
            { label: "Hot metal / brake material", value: "brake" },
            { label: "Burning rubber / tire", value: "rubber" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did you just come off a long downhill stretch or a lot of stop-and-go traffic before noticing the smoke?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "smoke_or_strong_smell_inside_the_cabin",
      display_label: "Smoke or strong smell inside the cabin",
      display_order: 6,
      questions: [
        {
          text: "Does the smoke or smell only come out when the heater or air conditioner is running?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it smell more like burning plastic and electrical, or more like burning leaves and dust?",
          multi_select: false,
          options: [
            { label: "Plastic / electrical", value: "electrical" },
            { label: "Leaves / dust", value: "dust" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this start the first time you turned on the heat for the season after a long stretch of not using it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are any dashboard warning lights on, or have any electrical features like windows, fans, or lights been acting up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the smoke visible coming out of the vents, or is it just a smell with no visible smoke?",
          multi_select: false,
          options: [
            { label: "Visible smoke", value: "visible" },
            { label: "Just a smell", value: "smell_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the smell get stronger when you turn the fan speed up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you been able to pull over and stop the car safely, or is this happening while you're calling from the road?",
          multi_select: false,
          options: [
            { label: "Pulled over safely", value: "safe" },
            { label: "Still on the road", value: "on_road" },
          ],
        },
      ],
    },
  ],
};

// 11. STEERING

const steering: CanonicalCategory = {
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

const tires: CanonicalCategory = {
  category: "tires",
  subcategories: [
    {
      slug: "visible_damage_nail_screw_bulge_cut",
      display_label: "Visible damage (nail / screw / bulge / cut)",
      display_order: 1,
      questions: [
        {
          text: "Which tire is it — front-left, front-right, rear-left, rear-right, or are you not sure?",
          multi_select: false,
          options: SINGLE_TIRE,
        },
        {
          text: "What do you see — a nail or screw sticking out, a bubble or bulge in the side, a cut or gash, or something else?",
          multi_select: false,
          options: [
            { label: "Nail or screw", value: "nail" },
            { label: "Bubble or bulge", value: "bulge" },
            { label: "Cut or gash", value: "cut" },
            { label: "Something else", value: "other" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the damage on the flat part of the tire that touches the road, or on the curved side wall of the tire?",
          multi_select: false,
          options: [
            { label: "Tread (touches the road)", value: "tread" },
            { label: "Sidewall (curved side)", value: "sidewall" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the tire holding air right now, or is it going flat?",
          multi_select: false,
          options: [
            { label: "Holding air", value: "holding" },
            { label: "Going flat", value: "flat" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the car drivable right now, or is it parked because the tire is too low to drive on?",
          multi_select: false,
          options: [
            { label: "Drivable", value: "drivable" },
            { label: "Parked / too low", value: "parked" },
          ],
        },
        {
          text: "Do you have a spare tire on the vehicle, or is the damaged tire still mounted?",
          multi_select: false,
          options: [
            { label: "Spare on the vehicle", value: "spare" },
            { label: "Damaged tire still mounted", value: "damaged" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did this happen suddenly today, or have you been driving on it for a few days?",
          multi_select: false,
          options: [
            { label: "Suddenly today", value: "today" },
            { label: "Driving on it for days", value: "days" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "tire_going_flat_losing_air",
      display_label: "Tire going flat / losing air",
      display_order: 2,
      questions: [
        {
          text: "Which tire keeps losing air — front-left, front-right, rear-left, rear-right, or more than one?",
          multi_select: false,
          options: SINGLE_TIRE,
        },
        {
          text: "Did the tire go flat suddenly, or has it been slowly losing air over days or weeks?",
          multi_select: false,
          options: [
            { label: "Suddenly", value: "sudden" },
            { label: "Slowly over days/weeks", value: "slow" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "How often are you having to add air — every day, every week, or every month?",
          multi_select: false,
          options: [
            { label: "Every day", value: "daily" },
            { label: "Every week", value: "weekly" },
            { label: "Every month", value: "monthly" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did you hear a hissing sound when it happened, or did you just notice it was low?",
          multi_select: false,
          options: [
            { label: "Heard hissing", value: "hiss" },
            { label: "Just noticed it was low", value: "noticed" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you driven over anything sharp recently, hit a pothole, or scraped a curb?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you looked the tire over and seen anything stuck in it like a nail or screw?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Is the car drivable to the shop right now, or does it need to be towed?",
          multi_select: false,
          options: [
            { label: "Drivable", value: "drivable" },
            { label: "Needs to be towed", value: "tow" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "low_pressure_warning_light_only",
      display_label: "Low pressure warning light only",
      display_order: 3,
      questions: [
        {
          text: "Is the warning light steady on, or is it flashing or blinking?",
          multi_select: false,
          options: [
            { label: "Steady on", value: "steady" },
            { label: "Flashing", value: "flashing" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "If it flashes, does it blink for about a minute and then stay solid, or does it just stay blinking?",
          multi_select: false,
          options: [
            { label: "Blinks then stays solid", value: "blink_solid" },
            { label: "Stays blinking", value: "always_blinking" },
            { label: "Not applicable", value: "na" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you checked the tires and do any of them actually look low?",
          multi_select: false,
          options: [
            { label: "Yes — one or more look low", value: "low" },
            { label: "Yes — all look fine", value: "fine" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "Did the light come on after a cold morning, or did it come on while driving on a warm day?",
          multi_select: false,
          options: [
            { label: "Cold morning", value: "cold" },
            { label: "Warm day driving", value: "warm" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you added air recently and the light still won't turn off?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had new tires put on or had the tires off the vehicle recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Has the light been coming on and off, or has it stayed on without going away?",
          multi_select: false,
          options: [
            { label: "Coming on and off", value: "intermittent" },
            { label: "Stays on", value: "stays" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "uneven_tire_wear_bald_spots",
      display_label: "Uneven tire wear / bald spots",
      display_order: 4,
      questions: [
        {
          text: "Where is the wear showing up — the inside edge, outside edge, center of the tread, or in patchy spots around the tire?",
          multi_select: true,
          options: [
            { label: "Inside edge", value: "inside" },
            { label: "Outside edge", value: "outside" },
            { label: "Center of tread", value: "center" },
            { label: "Patchy spots", value: "patchy" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is it happening on one tire, both front tires, both rear tires, or all four?",
          multi_select: false,
          options: [
            { label: "One tire", value: "one" },
            { label: "Both front", value: "front" },
            { label: "Both rear", value: "rear" },
            { label: "All four", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the tire look or feel bumpy and scalloped when you run your hand across the tread?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "When was the last time the tires were rotated or had an alignment done?",
          multi_select: false,
          options: [
            { label: "In the last 6 months", value: "lt_6_months" },
            { label: "6-12 months ago", value: "6_to_12" },
            { label: "Over a year ago", value: "gt_year" },
            { label: "Not sure / never", value: "unsure" },
          ],
        },
        {
          text: "Are you noticing this with any vibration in the steering wheel or seat while driving?",
          multi_select: true,
          options: [
            { label: "Steering wheel", value: "steering" },
            { label: "Seat", value: "seat" },
            { label: "Neither", value: "neither" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the vehicle pull to one side when you're driving on a flat, straight road?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you know about how many miles are on this set of tires?",
          multi_select: false,
          options: [
            { label: "Under 20k", value: "lt_20k" },
            { label: "20k-50k", value: "20_to_50k" },
            { label: "Over 50k", value: "gt_50k" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "dry_rot_sidewall_cracking",
      display_label: "Dry rot / sidewall cracking",
      display_order: 5,
      questions: [
        {
          text: "Are you seeing small cracks in the rubber on the side of the tire, the tread, or both?",
          multi_select: true,
          options: [
            { label: "Side of the tire", value: "sidewall" },
            { label: "Tread", value: "tread" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are the cracks just on the surface, or do they look deep enough to put a fingernail into?",
          multi_select: false,
          options: [
            { label: "Surface only", value: "surface" },
            { label: "Deep (fingernail fits)", value: "deep" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you know roughly how old the tires are, or about how many years you've had them?",
          multi_select: false,
          options: [
            { label: "Less than 3 years", value: "lt_3" },
            { label: "3-6 years", value: "3_to_6" },
            { label: "Over 6 years", value: "gt_6" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the vehicle sit parked for long stretches without being driven?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is it on one tire, or are you seeing the same cracking on all of them?",
          multi_select: false,
          options: [
            { label: "One tire", value: "one" },
            { label: "All of them", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have any of the tires lost air recently or shown a pressure warning?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the car parked outside in the sun most of the time, or kept in a garage?",
          multi_select: false,
          options: [
            { label: "Outside in the sun", value: "outside" },
            { label: "In a garage", value: "garage" },
            { label: "Mix of both", value: "mix" },
          ],
        },
      ],
    },
    {
      slug: "just_want_new_tires",
      display_label: "Just want new tires",
      display_order: 6,
      questions: [
        {
          text: "Are you replacing all four tires, just the front pair, just the rear pair, or only one?",
          multi_select: false,
          options: [
            { label: "All four", value: "all" },
            { label: "Front pair", value: "front" },
            { label: "Rear pair", value: "rear" },
            { label: "Only one", value: "one" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you know what brand or model of tire is currently on the vehicle, or do you want a recommendation?",
          multi_select: false,
          options: [
            { label: "Know the brand/model", value: "known" },
            { label: "Want a recommendation", value: "recommend" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are you looking for the lowest-cost option, a mid-range tire, or a longer-lasting premium tire?",
          multi_select: false,
          options: [
            { label: "Lowest cost", value: "low" },
            { label: "Mid-range", value: "mid" },
            { label: "Premium / longer-lasting", value: "premium" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you do mostly highway driving, mostly around-town driving, or a mix of both?",
          multi_select: false,
          options: [
            { label: "Mostly highway", value: "highway" },
            { label: "Mostly around town", value: "town" },
            { label: "A mix", value: "mix" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you drive in snow or heavy rain regularly, or mostly dry-weather driving?",
          multi_select: false,
          options: [
            { label: "Snow or heavy rain regularly", value: "wet" },
            { label: "Mostly dry weather", value: "dry" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the vehicle had an alignment in the last year, or would you like us to check it with the new tires?",
          multi_select: false,
          options: [
            { label: "Yes — recent alignment", value: "recent" },
            { label: "No — please check it", value: "check" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Are you planning to keep this vehicle for several more years, or only another year or two?",
          multi_select: false,
          options: [
            { label: "Several more years", value: "long" },
            { label: "Another year or two", value: "short" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "recent_tire_work_then_new_symptom",
      display_label: "Recent tire work then new symptom",
      display_order: 7,
      questions: [
        {
          text: "What work was done — new tires, a rotation, a patch or plug, a balance, or a flat repair?",
          multi_select: true,
          options: [
            { label: "New tires", value: "new" },
            { label: "Rotation", value: "rotation" },
            { label: "Patch or plug", value: "patch" },
            { label: "Balance", value: "balance" },
            { label: "Flat repair", value: "flat_repair" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Roughly when was the work done — a few days ago, a week ago, or longer?",
          multi_select: false,
          options: [
            { label: "A few days ago", value: "days" },
            { label: "A week ago", value: "week" },
            { label: "Longer than a week", value: "longer" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "What is the new symptom — vibration, noise, pulling, a warning light, or the tire losing air again?",
          multi_select: true,
          options: [
            { label: "Vibration", value: "vibration" },
            { label: "Noise", value: "noise" },
            { label: "Pulling", value: "pull" },
            { label: "Warning light", value: "light" },
            { label: "Losing air again", value: "leak" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "At what speed does the issue show up — only on the highway, only at lower speeds, or all the time?",
          multi_select: false,
          options: [
            { label: "Highway only", value: "highway" },
            { label: "Lower speeds only", value: "low" },
            { label: "All the time", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "If it's a vibration, do you feel it more in the steering wheel or in the seat?",
          multi_select: true,
          options: [
            { label: "Steering wheel", value: "steering" },
            { label: "Seat", value: "seat" },
            { label: "Not applicable", value: "na" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the same shop that did the work get a chance to look at it again, or is this the first time it's being checked?",
          multi_select: false,
          options: [
            { label: "Same shop looked again", value: "same_shop" },
            { label: "First time being checked", value: "first" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Was a tire pressure sensor disturbed, replaced, or does the warning light keep coming on since the work was done?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
  ],
};

// 13. VIBRATION

const vibration: CanonicalCategory = {
  category: "vibration",
  subcategories: [
    {
      slug: "steering_wheel_shake_at_highway_speed",
      display_label: "Steering wheel shake at highway speed",
      display_order: 1,
      questions: [
        {
          text: "Does the shaking start at a specific speed, like around 50 or 60 mph?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the shaking get better or go away if you speed up past that point?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "If you carefully let off the gas and coast, does the shaking stay the same?",
          multi_select: false,
          options: [
            { label: "Stays the same", value: "same" },
            { label: "Quiets down", value: "quiets" },
            { label: "Gets worse", value: "worse" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the shake mostly in the steering wheel, or do you also feel it in your seat?",
          multi_select: true,
          options: [
            { label: "Steering wheel", value: "steering" },
            { label: "Seat", value: "seat" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you hit a pothole, curb, or big bump recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had new tires put on, tires rotated, or wheels balanced in the last few months?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the car pull to one side at the same time the shaking happens?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "vibration_or_pulsing_when_braking",
      display_label: "Vibration or pulsing when braking",
      display_order: 2,
      questions: [
        {
          text: "Does the shaking only happen when you press the brake pedal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you feel the brake pedal pushing back up against your foot as you slow down?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is it worse when slowing down from highway speeds, or when stopping from low speeds?",
          multi_select: false,
          options: [
            { label: "Slowing from highway speeds", value: "highway" },
            { label: "Stopping from low speeds", value: "low" },
            { label: "Both", value: "both" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you feel the shake in the steering wheel, the seat, the brake pedal, or all three?",
          multi_select: true,
          options: [
            { label: "Steering wheel", value: "steering" },
            { label: "Seat", value: "seat" },
            { label: "Brake pedal", value: "pedal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does it get worse after a long downhill drive or after towing something heavy?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any brake work done in the last year?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the car pull to one side when you brake at the same time?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "shaking_at_idle_while_stopped",
      display_label: "Shaking at idle while stopped",
      display_order: 3,
      questions: [
        {
          text: "Does the shaking happen when the car is sitting still in Drive or Reverse?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it smooth out or get better when you shift into Park or Neutral?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it get noticeably worse when you turn the air conditioning on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the check engine light on, flashing, or has it been on recently?",
          multi_select: false,
          options: [
            { label: "Flashing", value: "flashing" },
            { label: "Solid on", value: "solid" },
            { label: "Off", value: "off" },
            { label: "On recently", value: "recent" },
          ],
        },
        {
          text: "Does the engine sound rough, sputtery, or like it's about to stall?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it shake more when the engine is cold first thing in the morning, or after it warms up?",
          multi_select: false,
          options: [
            { label: "When cold (morning)", value: "cold" },
            { label: "After it warms up", value: "warm" },
            { label: "About the same", value: "same" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any drop in gas mileage recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "shaking_when_speeding_up_or_going_uphill",
      display_label: "Shaking when speeding up or going uphill",
      display_order: 4,
      questions: [
        {
          text: "Does the shaking only happen when you're pressing the gas, and go away when you let off?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is it worse when you're really pushing the engine, like passing on the highway or climbing a hill?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear any clicking or popping noises when turning, especially in tight parking lots?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any grease or oil splatter on the inside of your wheels?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the shaking come and go, or is it there every time you accelerate?",
          multi_select: false,
          options: [
            { label: "Comes and goes", value: "intermittent" },
            { label: "Every time I accelerate", value: "every" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you feel it more through the floor and seat than the steering wheel?",
          multi_select: true,
          options: [
            { label: "Floor", value: "floor" },
            { label: "Seat", value: "seat" },
            { label: "Steering wheel", value: "steering" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the transmission been slipping or shifting strangely along with the shaking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "shaking_or_bouncing_over_bumps_and_rough_roads",
      display_label: "Shaking or bouncing over bumps and rough roads",
      display_order: 5,
      questions: [
        {
          text: "Does the car keep bouncing more than once or twice after going over a bump?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you hear a clunking or knocking noise when you hit bumps or dips?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the car feel like it's wandering or hard to keep straight on uneven pavement?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the ride a lot rougher than it used to be, even on roads that used to feel fine?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any oily fluid leaking near the wheels or shock absorbers?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the front end dive down more than usual when you brake hard?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are your tires wearing unevenly, with bald spots or scalloped patches?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
      ],
    },
    {
      slug: "constant_vibration_that_doesnt_change_with_speed",
      display_label: "Constant vibration that doesn't change with speed",
      display_order: 6,
      questions: [
        {
          text: "Is the vibration there even when the car is barely moving, like in a parking lot?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does it stay roughly the same whether you're going 25 mph or 65 mph?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Do you feel it more in the floor, the seat, or all over the car?",
          multi_select: true,
          options: [
            { label: "Floor", value: "floor" },
            { label: "Seat", value: "seat" },
            { label: "All over the car", value: "all" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you driven through anything recently that could have damaged a wheel, like a deep pothole?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the vibration change at all when you turn the steering wheel left or right?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had a tire repaired or patched recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does it feel like something is loose or flopping under the car?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
  ],
};

// 14. WARNING LIGHT

const warningLight: CanonicalCategory = {
  category: "warning_light",
  subcategories: [
    {
      slug: "check_engine_light",
      display_label: "Check engine light",
      display_order: 1,
      questions: [
        {
          text: "Is the light flashing/blinking or just steady on?",
          multi_select: false,
          options: [
            { label: "Flashing / blinking", value: "flashing" },
            { label: "Steady on", value: "steady" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the engine feel rough, like it's shaking, hesitating, or losing power?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you noticed any unusual smells, especially something that smells like rotten eggs or burning?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on right after you filled up with gas? Did you check that your gas cap is tight?",
          multi_select: false,
          options: [
            { label: "Yes — gas cap tightened, light still on", value: "tightened_still_on" },
            { label: "Yes — gas cap was loose", value: "was_loose" },
            { label: "No relation to fill-up", value: "unrelated" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the car using more gas than usual, or is there any black smoke coming out of the tailpipe?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "About how long has the light been on, and does it ever turn itself off and come back on later?",
          multi_select: false,
          options: [
            { label: "On for days — stays on", value: "days_stays" },
            { label: "On for weeks — stays on", value: "weeks_stays" },
            { label: "Comes on and goes off", value: "intermittent" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any clicking, ticking, or popping sounds from the engine while the light is on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "service_engine_soon_or_maintenance_required_light",
      display_label: "Service engine soon / maintenance required light",
      display_order: 2,
      questions: [
        {
          text: "Does the message on your dash say \"Service Engine Soon,\" \"Maintenance Required,\" or \"Service Due\" — anything that sounds like a reminder rather than an alarm?",
          multi_select: false,
          options: [
            { label: "Service Engine Soon", value: "ses" },
            { label: "Maintenance Required", value: "maint" },
            { label: "Service Due", value: "due" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "About how many miles has it been since your last oil change or scheduled service?",
          multi_select: false,
          options: [
            { label: "Under 3,000 miles", value: "lt_3k" },
            { label: "3,000-5,000 miles", value: "3_to_5k" },
            { label: "5,000-10,000 miles", value: "5_to_10k" },
            { label: "Over 10,000 miles", value: "gt_10k" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the car feel and drive completely normal otherwise?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on at a round-number mileage, like right at 5,000 or 75,000 miles?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is there a separate check engine light on too, or is this the only warning showing?",
          multi_select: false,
          options: [
            { label: "Check engine also on", value: "ce_too" },
            { label: "Only this warning", value: "only_this" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has anyone reset this reminder for you recently after a service?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "battery_charging_light",
      display_label: "Battery / charging light",
      display_order: 3,
      questions: [
        {
          text: "Did the light come on suddenly while you were driving, or did it gradually start showing up?",
          multi_select: false,
          options: SUDDEN_GRADUAL,
        },
        {
          text: "When you turn the car off and try to start it again, does it crank slowly, click, or not start at all?",
          multi_select: false,
          options: [
            { label: "Cranks slowly", value: "slow" },
            { label: "Just clicks", value: "click" },
            { label: "Won't start at all", value: "no_start" },
            { label: "Starts normally", value: "normal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed your headlights or dashboard lights getting dimmer, especially at idle or when you turn other things on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are your power windows, radio, or wipers running slower or acting weird?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had to jump-start the car recently, or have you replaced the battery in the last couple of years?",
          multi_select: false,
          options: [
            { label: "Jumped recently", value: "jumped" },
            { label: "Battery replaced in last 2 years", value: "replaced" },
            { label: "Neither", value: "neither" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you hear any squealing or whining sound from under the hood when the light is on?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the light go off when you rev the engine, or does it stay on no matter what?",
          multi_select: false,
          options: [
            { label: "Goes off when revving", value: "goes_off" },
            { label: "Stays on no matter what", value: "stays" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "oil_pressure_light",
      display_label: "Oil pressure light",
      display_order: 4,
      questions: [
        {
          text: "Did you pull over and shut the engine off when the light came on, or have you been driving with it on?",
          multi_select: false,
          options: [
            { label: "Pulled over and shut off", value: "stopped" },
            { label: "Still driving with it on", value: "driving" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you checked the oil level on the dipstick? If yes, was it low, empty, or normal?",
          multi_select: false,
          options: [
            { label: "Low", value: "low" },
            { label: "Empty / off the stick", value: "empty" },
            { label: "Normal", value: "normal" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "When was your last oil change, and do you know if the car has been burning or leaking oil between changes?",
          multi_select: false,
          options: [
            { label: "Recent — no burning/leaking", value: "recent_no" },
            { label: "Recent — burning or leaking", value: "recent_yes" },
            { label: "Long time ago", value: "long_ago" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do you hear any ticking, tapping, or knocking noises from the engine when it's running?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on suddenly, or does it flicker on and off — maybe at idle or when stopping at a light?",
          multi_select: false,
          options: [
            { label: "Suddenly and stayed on", value: "sudden" },
            { label: "Flickers on and off", value: "flicker" },
            { label: "Only at idle", value: "idle" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any oil spots on your driveway or garage floor?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the light come on and stay on, or does it go away once you start driving?",
          multi_select: false,
          options: [
            { label: "Comes on and stays on", value: "stays" },
            { label: "Goes away once driving", value: "goes_away" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "engine_temperature_light",
      display_label: "Engine temperature light",
      display_order: 5,
      questions: [
        {
          text: "Is the temperature gauge reading high or in the red zone, or is the gauge normal but the light is still on?",
          multi_select: false,
          options: [
            { label: "Gauge high / red zone", value: "high" },
            { label: "Gauge normal, light on", value: "normal_light" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you seen any steam or smoke coming from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you checked the coolant reservoir? Is it full, low, or completely empty?",
          multi_select: false,
          options: [
            { label: "Full", value: "full" },
            { label: "Low", value: "low" },
            { label: "Empty", value: "empty" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "Have you had to add coolant or water to the car recently, or noticed green, orange, or pink puddles where you park?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the heater inside the car still blow hot, or does it blow cold air now?",
          multi_select: false,
          options: [
            { label: "Blows hot", value: "hot" },
            { label: "Blows cold", value: "cold" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did the light come on after sitting in heavy traffic, climbing a hill, or pulling a load?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you continued driving with the light on, or did you stop right away?",
          multi_select: false,
          options: [
            { label: "Continued driving", value: "continued" },
            { label: "Stopped right away", value: "stopped" },
          ],
        },
      ],
    },
    {
      slug: "tpms_tire_pressure_light",
      display_label: "TPMS / tire pressure light",
      display_order: 6,
      questions: [
        {
          text: "Has it been noticeably colder outside recently — like a cold morning or the first chilly day of the season?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the light steady on, or is it flashing on and off?",
          multi_select: false,
          options: [
            { label: "Steady on", value: "steady" },
            { label: "Flashing", value: "flashing" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Do any of your tires look visibly low or flat compared to the others?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Have you noticed the car pulling to one side, riding rougher, or feeling slower to respond?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did you recently have tires rotated, replaced, or air added?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Have you driven over any potholes, debris, curbs, or noticed a slow leak in any tire?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the light go off after you've been driving for a while, or does it stay on the whole trip?",
          multi_select: false,
          options: [
            { label: "Goes off after a while", value: "goes_off" },
            { label: "Stays on the whole trip", value: "stays" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "abs_anti_lock_brake_light",
      display_label: "ABS / anti-lock brake light",
      display_order: 7,
      questions: [
        {
          text: "Are the regular brakes still working normally when you press the pedal — stopping the car like usual?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Is the red BRAKE light on too, or is it just the yellow ABS light?",
          multi_select: false,
          options: [
            { label: "Both lights on", value: "both" },
            { label: "Just yellow ABS", value: "abs_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "When you brake hard or on a slippery surface, do you feel pulsing or vibrating in the pedal like normal, or nothing at all?",
          multi_select: false,
          options: [
            { label: "Pulsing/vibrating like normal", value: "normal" },
            { label: "Nothing at all", value: "none" },
            { label: "Haven't tested", value: "untested" },
          ],
        },
        {
          text: "Have you noticed the car pulling to one side when braking, or one wheel locking up?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on right after driving through deep water, a car wash, or hitting a big pothole or curb?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you had any brake work, tire work, or wheel bearing work done recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does the light come on every time you start the car, or only sometimes while driving?",
          multi_select: false,
          options: [
            { label: "Every time I start", value: "every_start" },
            { label: "Only sometimes while driving", value: "sometimes" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "brake_system_red_light",
      display_label: "Brake system (red) light",
      display_order: 8,
      questions: [
        {
          text: "First thing — is your parking brake or emergency brake fully released?",
          multi_select: false,
          options: [
            { label: "Yes — fully released", value: "released" },
            { label: "No / not sure", value: "not_sure" },
          ],
        },
        {
          text: "Does the brake pedal feel different — softer, spongy, sinking to the floor, or harder than normal?",
          multi_select: false,
          options: [
            { label: "Softer / spongy", value: "soft" },
            { label: "Sinking to the floor", value: "sinking" },
            { label: "Harder than normal", value: "hard" },
            { label: "Feels normal", value: "normal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you checked the brake fluid reservoir under the hood? Was the level near the MIN line or below?",
          multi_select: false,
          options: [
            { label: "At or above MIN", value: "ok" },
            { label: "Below MIN", value: "low" },
            { label: "Haven't checked", value: "unchecked" },
          ],
        },
        {
          text: "Is the yellow ABS light on at the same time, or is it just the red brake light?",
          multi_select: false,
          options: [
            { label: "Both lights on", value: "both" },
            { label: "Just red brake light", value: "brake_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Does the car still stop normally when you press the brake, or does it take longer than usual?",
          multi_select: false,
          options: [
            { label: "Stops normally", value: "normal" },
            { label: "Takes longer", value: "longer" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any fluid leaking near any of the wheels or in the spot where you park?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Did the light come on suddenly, or did it start coming on and going off before staying on?",
          multi_select: false,
          options: [
            { label: "Suddenly and stayed on", value: "sudden" },
            { label: "Came and went, then stayed", value: "gradual" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "airbag_srs_light",
      display_label: "Airbag / SRS light",
      display_order: 9,
      questions: [
        {
          text: "Has the car been in any kind of accident, collision, or hard bump recently — even a minor one?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has anyone done work on the seats, dashboard, steering wheel, or seat belts recently?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Is there anything stuck in any seat belt buckle — a coin, a crumb, a piece of plastic?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Did you recently have a car seat installed or use the front passenger seat occupancy area differently than usual?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the light flash a pattern of blinks, or is it just on steady?",
          multi_select: false,
          options: [
            { label: "Flashes a pattern", value: "pattern" },
            { label: "Steady on", value: "steady" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has the car been sitting unused for a long time, or has the battery been disconnected or replaced recently?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on right after driving through a flooded area or getting the interior wet?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "traction_control_stability_light",
      display_label: "Traction control / stability light",
      display_order: 10,
      questions: [
        {
          text: "Is the light on steady all the time, or does it only flash briefly when the road is slippery?",
          multi_select: false,
          options: [
            { label: "Steady all the time", value: "steady" },
            { label: "Flashes only on slippery roads", value: "flashes" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the ABS light on at the same time, or just the traction/stability light?",
          multi_select: false,
          options: [
            { label: "Both lights on", value: "both" },
            { label: "Just traction/stability", value: "traction_only" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed the car feeling slippery, losing grip, or wheels spinning when you don't expect it?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did the light come on after driving in snow, rain, mud, or off-road?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Have you recently put on new tires, especially a different size or only replaced one or two?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did you accidentally press the traction-control button to turn the system off?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering feel heavier, or have you noticed any other warning lights joining this one?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
    {
      slug: "power_steering_eps_light",
      display_label: "Power steering / EPS light",
      display_order: 11,
      questions: [
        {
          text: "Is the steering wheel harder to turn than usual, especially at low speeds or when parking?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Does the steering feel heavy all the time, or only when the light is on?",
          multi_select: false,
          options: [
            { label: "All the time", value: "all_time" },
            { label: "Only when the light is on", value: "with_light" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you heard any whining or groaning sound when turning the wheel?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Did you notice the light come on right after starting the car, or did it come on while you were already driving?",
          multi_select: false,
          options: [
            { label: "Right after starting", value: "startup" },
            { label: "While already driving", value: "driving" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Has your battery been weak, dead, or recently replaced?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Are there any reddish-pink fluid spots where you park (only applies if your car uses hydraulic power steering, not all do)?",
          multi_select: false,
          options: YES_NO_UNCHECKED,
        },
        {
          text: "Does the light come on and go off on its own, or does it stay on the whole time?",
          multi_select: false,
          options: [
            { label: "Comes on and goes off", value: "intermittent" },
            { label: "Stays on", value: "stays" },
            { label: "Not sure", value: "unsure" },
          ],
        },
      ],
    },
    {
      slug: "multiple_warning_lights_at_once",
      display_label: "Multiple warning lights at once",
      display_order: 12,
      questions: [
        {
          text: "Which lights are on — can you describe the colors and shapes, or read what they say?",
          multi_select: true,
          options: [
            { label: "Check engine", value: "check_engine" },
            { label: "Battery / charging", value: "battery" },
            { label: "Oil pressure", value: "oil" },
            { label: "Temperature", value: "temp" },
            { label: "ABS", value: "abs" },
            { label: "Brake (red)", value: "brake" },
            { label: "Airbag / SRS", value: "airbag" },
            { label: "Traction control", value: "traction" },
            { label: "Power steering", value: "ps" },
            { label: "TPMS", value: "tpms" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Did all the lights come on at the same time, or did they show up one after another?",
          multi_select: false,
          options: [
            { label: "All at the same time", value: "same" },
            { label: "One after another", value: "staggered" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Is the car running rough, losing power, or do the headlights and dashboard look dimmer than normal?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "When you try to start the car, does it crank slowly, click, or struggle?",
          multi_select: false,
          options: [
            { label: "Cranks slowly", value: "slow" },
            { label: "Just clicks", value: "click" },
            { label: "Struggles to start", value: "struggle" },
            { label: "Starts normally", value: "normal" },
            { label: "Not sure", value: "unsure" },
          ],
        },
        {
          text: "Have you noticed any burning smell or smoke from under the hood?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
        {
          text: "Has the battery been replaced recently, or have you had any electrical work done on the car?",
          multi_select: false,
          options: RECENT_NO_UNSURE,
        },
        {
          text: "Does anything electrical inside the car act weird — radio resetting, gauges jumping around, windows slow, dome light flickering?",
          multi_select: false,
          options: YES_NO_UNSURE,
        },
      ],
    },
  ],
};

export const CANONICAL_CATALOG: CanonicalCategory[] = [
  brakes,
  electrical,
  hvac,
  leak,
  noise,
  other,
  performance,
  pulling,
  smell,
  smoke,
  steering,
  tires,
  vibration,
  warningLight,
];
