import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, RECENT_NO_UNSURE, SUDDEN_GRADUAL, FREQUENCY_OPTS, BATTERY_AGE } from "../option-presets.ts";

export const electrical: CanonicalCategory = {
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
