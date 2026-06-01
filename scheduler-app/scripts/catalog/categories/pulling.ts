import type { CanonicalCategory } from "../types.ts";
import { YES_NO_UNSURE, YES_NO_UNCHECKED, RECENT_NO_UNSURE, SUDDEN_ALWAYS } from "../option-presets.ts";

export const pulling: CanonicalCategory = {
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
