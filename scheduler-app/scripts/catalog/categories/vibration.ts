import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE } from "../option-presets.ts";

export const vibration: CanonicalCategory = {
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
