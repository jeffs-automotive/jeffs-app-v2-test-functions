import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SUDDEN_GRADUAL, LOCATION_MULTI, SPEED_BANDS } from "../option-presets.ts";

export const brakes: CanonicalCategory = {
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
