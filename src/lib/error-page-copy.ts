/**
 * Website error page (a page that broke while loading). DRAFT wording, waiting for Abraham's OK
 * (docs/website-open-decisions.md, item W1). Shown on the preview site only; the live site keeps Next's standard
 * error screen until he approves these exact words.
 */
export const ERROR_PAGE_DRAFT = {
  title: "Something went wrong.",
  body: "Please try again, or call us at (845) 777-7585.",
  retry: "Try again",
};
/** Flip to true only after Abraham approves ERROR_PAGE_DRAFT word for word. */
export const ERROR_PAGE_LIVE_APPROVED = false;

/** The branded error page shows on previews (and locally); on the live site only once approved. */
export function brandedErrorPageShown(siteEnv: string | undefined = process.env.HUP_SITE_ENV): boolean {
  return ERROR_PAGE_LIVE_APPROVED || siteEnv !== "production";
}
