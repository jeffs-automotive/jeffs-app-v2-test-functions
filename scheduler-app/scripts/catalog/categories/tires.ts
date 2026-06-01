import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SINGLE_TIRE } from "../option-presets.ts";

export const tires: CanonicalCategory = {
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
