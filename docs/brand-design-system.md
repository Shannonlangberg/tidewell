# PLANTED. Official brand design system, version 1.0

**This is the source of truth for all visual work.** It applies to the public website, PLANTED HQ, and every future application. Where any other document, component or token disagrees with this file, this file wins.

Implementation notes added by the build team are in the section at the end ("Implementation notes"). The brand text above that section is the brief as supplied, unchanged.

---

## 1. Brand identity

**Name:** PLANTED. Always include the full stop.
**Descriptor:** PROPERTY MANAGEMENT
**Primary tagline:** A better place for your property.
**Secondary brand statement:** People. Property. Potential.

**Personality:** Modern, premium, architectural, confident, approachable, minimalist, professional, innovative, understated.

**Philosophy:** Strong foundations create lasting growth. PLANTED. has a subtle biblical connection to being planted, established and flourishing. This meaning should remain understated.

The brand must NOT resemble a gardening company, a landscaping company, a nursery, or a traditional real estate franchise.

NO leaves, trees, plant icons, green branding, generic roofline logos, bright colours, or cartoon illustrations.

## 2. Official colour palette

| Name | Hex | Used for |
|---|---|---|
| Primary charcoal | `#252525` | Primary branding, headings, navigation, buttons, dark sections, vehicle graphics |
| Warm ivory | `#F5F1EA` | Main backgrounds, light text on charcoal, stationery, cards |
| Soft white | `#FAF8F4` | Website backgrounds, forms, cards, content sections |
| Stone | `#D6CEC3` | Secondary backgrounds, subtle dividers, supporting UI |
| Taupe | `#A89A8B` | Secondary details, decorative elements, supporting typography |
| Clay | `#947B69` | Accent elements, selected details, supporting graphics. Used sparingly |
| Deep black | `#171717` | High contrast, dark interface elements |
| Muted grey | `#77736E` | Secondary text, supporting labels |
| Border | `#DED8D0` | Borders |

**Distribution:** 45% warm ivory / soft white, 35% charcoal, 15% stone / taupe, 5% clay.

Never introduce green into the brand identity. Avoid bright accent colours. Use warm architectural neutrals.

## 3. Typography

**Primary display font: Cormorant Garamond** (400, 500, 600). For the wordmark inspiration, large headings, hero typography, editorial statements and premium marketing material.

**Secondary font: DM Sans** (400, 500, 600, 700). For navigation, body text, buttons, forms, tables, dashboard interfaces, property information and labels.

Rules: display headings large, elegant, editorial. Body clean, modern, highly readable. Navigation DM Sans Medium. Small labels uppercase with increased letter spacing.

Avoid heavy geometric fonts, excessively bold headings, decorative script fonts, too many font families.

## 4. Logo

Primary logo: **PLANTED.** in an elegant serif wordmark. The full stop is permanent. The wordmark is the hero of the brand.

Secondary descriptor: PROPERTY MANAGEMENT in uppercase DM Sans with generous letter spacing.

Variations: charcoal logo on ivory; ivory logo on charcoal; standalone PLANTED. wordmark; **P.** monogram (elegant serif capital P with a period) for favicon, app icon, social profile, business card reverse, embossed stationery, small branded details.

Do not add leaves, buildings or decorative icons to the logo. For digital use create consistent vector SVG assets; for print, outlined vector artwork. Do not rely on a live font as the final logo asset.

## 5. Premium physical branding

Tactile branding is a signature feature. Business cards: thick stock (600gsm or thicker where practical). Front: charcoal, raised PLANTED. wordmark, PROPERTY MANAGEMENT descriptor, small champagne metallic detail. Back: warm ivory, contact information, large embossed P. monogram. Finishes: sculpted embossing, debossing, subtle champagne foil, textured uncoated stock, premium edge finishing. Avoid glossy plastic-looking cards, bright metallic gold, excessive decorative effects. The brand should feel expensive because of materials, typography and restraint.

## 6. Website design language

**Style:** premium architectural editorial. Inspiration: modern architecture studios, boutique property developers, premium hospitality brands, contemporary Australian design agencies.

**Layout:** generous whitespace, strong typography, large architectural photography, clean alignment, refined grid systems.

**Borders:** thin, subtle, neutral.

**Border radius:** minimal. Buttons 4px, cards 6px, inputs 4px. Avoid excessive rounded corners.

**Shadows:** very subtle. Avoid floating card-heavy designs.

**Buttons:** primary = charcoal background, ivory text, small radius; hover slightly lighter charcoal. Secondary = transparent background, charcoal border, charcoal text.

**Dark sections:** ivory text on charcoal.

**Navigation:** minimal, professional, generous spacing.

**Animations:** subtle fades, gentle reveals, refined hover states. Avoid excessive motion.

## 7. PLANTED HQ design

PLANTED HQ is the internal operating platform. It must share the PLANTED. identity but prioritise clarity and operational efficiency.

- Soft white application background.
- Charcoal navigation.
- Ivory and stone surfaces.
- DM Sans as the primary interface font.
- Cormorant Garamond reserved for brand headings, welcome screens and selected editorial elements.
- Avoid serif fonts for data tables, forms, financial figures, task lists and operational dashboards.

HQ should feel like a modern premium SaaS platform, not an old-fashioned property management database.

UI requirements: clean navigation, consistent spacing, readable tables, clear status indicators, excellent search, fast interactions, responsive design, accessible contrast.

Use semantic colours for important statuses such as errors, warnings and success. These functional colours are exceptions to the neutral brand palette. Do not sacrifice usability for aesthetics.

## 8. Vehicle branding

Minimal and sophisticated. PLANTED. with PROPERTY MANAGEMENT beneath, cream or ivory lettering on dark vehicles. Optional: People. Property. Potential. Use the confirmed business website only. Large wordmark across front doors, small descriptor beneath, optional minimal rear tailgate branding, generous negative space. No large stripes, diagonal graphics, full wraps, oversized shapes, gardening imagery or bright colours. The vehicle stays largely its original colour.

## 9. Property signage

Charcoal background, ivory typography, large PLANTED. wordmark. Clear status: FOR LEASE, LEASED, PROPERTY MANAGEMENT. Simple layouts, no generic real estate advertising aesthetics. Contact information readable from an appropriate distance. Include required agency and regulatory details.

## 10. Photography

Architectural, warm, contemporary, authentic, premium. Australian homes, coastal properties, modern residential architecture, thoughtful interiors, natural materials. Natural light, warm tones, soft shadows. Avoid generic corporate stock, people shaking hands, gardening imagery, overly staged luxury mansions, heavy filters. Properties should be realistic for the Australian residential market.

## 11. Brand voice

Warm, confident, clear, professional, understated, human. Australian English. Avoid exaggerated sales claims.

Approved phrases: A better place for your property. / Property management, thoughtfully reimagined. / People. Property. Potential. / Built on strong foundations. / More than management. Peace of mind. / Good property management is an investment in the future.

## 12. Future brand architecture

Parent brand PLANTED.; current business PLANTED. Property Management. Future divisions: PLANTED. Stays, Services, Developments, Capital. All share logo architecture, typography, palette, design principles and voice. No unrelated visual identities.

## 13. CSS design tokens

```css
:root {
  --planted-charcoal: #252525;
  --planted-ivory: #F5F1EA;
  --planted-white: #FAF8F4;
  --planted-stone: #D6CEC3;
  --planted-taupe: #A89A8B;
  --planted-clay: #947B69;
  --planted-black: #171717;
  --planted-grey: #77736E;
  --planted-border: #DED8D0;

  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'DM Sans', Arial, sans-serif;

  --radius-button: 4px;
  --radius-card: 6px;
  --radius-input: 4px;
}
```

## 14. Final design principle

Premium without being pretentious. Modern without being trendy. Professional without being corporate. Approachable without being casual. Distinctive without being complicated. Equally appropriate on a $2 million property development, a residential rental management website, a modern internal software platform, a premium business card, a charcoal Mazda BT-50, and a national property group headquarters. Consistency is essential.

---

## Implementation notes (build team)

These are decisions made while implementing the brief. They do not change it.

**Tokens.** `app/planted-tokens.css` is the code form of section 13 plus the derived tokens below. Both HQ and (over time) the public site read from it. Use the `--planted-*` names; do not introduce new hex values in components.

**Contrast.** The brief asks for accessible contrast, and one palette colour cannot meet it for body-size text:

| Pairing | Ratio | Verdict |
|---|---|---|
| Muted grey `#77736E` on soft white `#FAF8F4` | 4.43:1 | Just under 4.5:1 |
| Muted grey on warm ivory `#F5F1EA` | about 4.2:1 | Under 4.5:1 |
| Muted grey on white `#FFFFFF` | 4.71:1 | Passes |
| Clay `#947B69` on soft white | about 3.6:1 | Large text and decoration only |

So `--planted-grey` (`#77736E`) is kept for large text, icons and non-essential labels, and body-size secondary text uses the derived **`--planted-grey-text: #6F6B66`** (about 5.0:1 on soft white, 4.7:1 on ivory), which is the same colour family one step darker. Where clay is needed as small text, use **`--planted-clay-text: #7A6353`**. Taupe on charcoal passes (about 5.6:1) and is used for secondary text in the dark navigation.

**On stone, use charcoal.** `--planted-grey-text` on stone `#D6CEC3` is only 3.4:1, so any text on a stone surface uses charcoal (14.5:1 on soft white, about 10:1 on stone), or charcoal at 80% opacity for secondary text. Do not put grey or clay text on stone.

**Semantic status colours** (an explicit exception in section 7) are muted, warm-leaning and never the only carrier of meaning: always a dot or icon plus a text label. They are defined in `app/planted-tokens.css` as `--status-*`.

**Radius.** 4px for buttons and inputs, 6px for cards and panels. Nothing larger except full circles for avatars.

**Serif use in HQ.** Cormorant Garamond appears only in the wordmark, the welcome heading on the dashboard, sign-in and empty-state titles. Never in tables, forms, task lists, statistics or any figure.
