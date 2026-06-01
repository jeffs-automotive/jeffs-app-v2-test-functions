import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED } from "../option-presets.ts";

export const smoke: CanonicalCategory = {
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
