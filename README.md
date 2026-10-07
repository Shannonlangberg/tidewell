# Tidewell website

Marketing site for Tidewell: holiday home management on the Copper Coast, South Australia.
Plain HTML, CSS and a little JavaScript. No framework, no build step.

```
index.html     the one-page site
thanks.html    shown after a form submit when JavaScript is off
styles.css     all styling
script.js      footer year and the in-page form submit
favicon.svg    the half-sun mark
netlify.toml   Netlify settings
```

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Or open `index.html` directly in a browser.

The enquiry form posts to Netlify Forms, so on a local server the form will show
"That didn't send" when you submit it. That is expected. It only works once deployed.

## Deploy on Netlify

1. In Netlify choose **Add new site, Import an existing project** and connect the GitHub repo.
2. Leave the build command empty. Set the publish directory to `.` (already set in `netlify.toml`).
3. Deploy. Netlify detects the form (`name="enquiry"`) from the HTML on the first deploy.
4. In **Site configuration, Forms, Form notifications**, add an email notification so enquiries reach Shannon and Court.
5. Add the custom domain under **Domain management** once it's chosen.

Without JavaScript the form posts normally and Netlify sends the visitor to `thanks.html`.
With JavaScript it submits in the page and shows a success message.

## Pre-launch checklist

- [ ] Domain and business name decided and registered
- [ ] ABN and licence details added (see the HTML comment in the footer of `index.html`)
- [ ] Contact details added (none are on the site yet, by design)
- [ ] Every promise on the page is true on launch day:
  - [ ] Live dashboard exists and owners can use it
  - [ ] Photos of every room after every clean
  - [ ] Replies inside the hour, 8am to 10pm
  - [ ] No lock-in after the first Easter
- [ ] Prices confirmed: 18% of accommodation revenue plus GST, setup $3,000 to $5,000
- [ ] FAQ answers read through and confirmed (especially "Can I keep my existing listing?")
- [ ] Real photos added
- [ ] Privacy policy added and linked from the footer and the form
- [ ] Open Graph image added (`og:image` and `twitter:card` set to `summary_large_image`)
- [ ] Add `og:url` and the business `url` in the JSON-LD once the domain is live
- [ ] Netlify form notification tested with a real enquiry

## Brand notes

Paper `#F1ECE1`, ink navy `#12263A`, copper text `#8F4E22` (text on paper only),
copper graphic `#B8703F`, muted ink `#44566A`.
Instrument Serif for headings and money figures, Instrument Sans for body.
Hairlines instead of boxes. No cards, shadows, gradients, icons or stock photos.
The tide line and rising half-sun in the hero is the one memorable element; it respects `prefers-reduced-motion`.
