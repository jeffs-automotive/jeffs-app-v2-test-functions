import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE } from "../option-presets.ts";

export const smell: CanonicalCategory = {
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
