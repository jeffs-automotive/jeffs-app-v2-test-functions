import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SUDDEN_GRADUAL } from "../option-presets.ts";

export const warningLight: CanonicalCategory = {
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
