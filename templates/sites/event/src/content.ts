/**
 * Everything the invitation says. Change this file to make it someone else's:
 * the names, the date, the venue, the day's plan and the questions guests ask.
 * The sample event below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  /** The hosts. "business" is the kit's word for whoever the site belongs to. */
  business: {
    name: "Amira & Daniel",
    tagline: "We're getting married, and we'd love you there.",
    description: "Join us for a day of vows, food and dancing in the Franschhoek valley.",
    email: "rsvp@amira-daniel.example",
    whatsapp: "+27 82 555 0177",
    address: "La Colline Estate, Franschhoek"
  } satisfies Business,

  brand: {
    primary: "#be185d",
    accent: "#d4a373",
    background: "#fffaf6",
    surface: "#fdf0ea",
    text: "#2d1b24",
    muted: "#7a5c68",
    radius: 18,
    font: "Georgia, 'Times New Roman', serif"
  } satisfies Brand,

  nav: [
    { label: "The day", href: "#schedule" },
    { label: "Venue", href: "#venue" },
    { label: "RSVP", href: "#rsvp" },
    { label: "FAQ", href: "#faq" }
  ] satisfies NavLink[],

  event: {
    eyebrow: "Save the date",
    title: "Amira & Daniel",
    /** When it starts, with its time zone, so the countdown is right wherever guests are. */
    startsAt: "2027-03-20T15:00:00+02:00",
    dateText: "Saturday, 20 March 2027 · 3pm",
    rsvpBy: "31 January 2027",
    art: "💍"
  },

  schedule: [
    { time: "15:00", title: "Ceremony", text: "In the olive grove. Please be seated by 14:45." },
    { time: "16:00", title: "Drinks & canapés", text: "On the terrace, with a string quartet." },
    { time: "18:30", title: "Dinner", text: "A long-table feast in the barn." },
    { time: "21:00", title: "Dancing", text: "Until late. Shuttles back to town from 23:00." }
  ],

  venue: {
    name: "La Colline Estate",
    address: "Robertsvlei Road, Franschhoek, 7690",
    /** Used for the map and the directions link. */
    mapQuery: "La Colline Estate Franschhoek",
    notes: "Free parking on the estate. Shuttles run from the Franschhoek village square from 14:00."
  },

  details: [
    { title: "Dress code", text: "Garden formal. Comfortable shoes for the lawn." },
    { title: "Gifts", text: "Your company is the gift. If you'd like to, there is a honeymoon fund — ask us for the details." },
    { title: "Stay", text: "We have a few rooms held at two guesthouses in the village. Mention our names when you book." }
  ],

  rsvp: {
    title: "Will you join us?",
    intro: "Please let us know by 31 January 2027, one reply per invitation.",
    submitLabel: "Send my RSVP",
    successMessage: "Thank you! Your reply is in. We can't wait to celebrate with you."
  },

  faq: [
    { q: "Can I bring a plus-one?", a: "Your invitation says how many seats are held for you. If you're unsure, message us." },
    { q: "Are children welcome?", a: "We love your little ones, but this is an adults-only celebration." },
    { q: "Is the venue accessible?", a: "Yes: the ceremony, terrace and barn are step-free, with accessible bathrooms." },
    { q: "What if it rains?", a: "Everything moves under cover in the barn. The day goes ahead, rain or shine." }
  ],

  /** Where RSVPs go. Leave the endpoint empty to use the guest's email app. */
  form: {} satisfies FormSettings
};
