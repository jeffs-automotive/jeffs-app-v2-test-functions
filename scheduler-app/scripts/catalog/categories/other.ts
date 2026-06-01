import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED } from "../option-presets.ts";

export const other: CanonicalCategory = {
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
