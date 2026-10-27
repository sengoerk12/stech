# S TECH mobile design system

Dark-first premium gaming: orange primary action, blue secondary accents, graphite surfaces and restrained geometric campaign graphics. The supplied logo is preserved without regeneration. No third-party artwork is used.

Tokens live in `apps/mobile/src/theme/index.ts`. Inter is used for readable body/UI text; Rajdhani for gaming headlines. Spacing uses a 4-point scale; cards use 20px radius, buttons 12px. Controls have at least 44–54px hit areas. Body text supports font scaling; status uses words/icons as well as color. Cards and content grow rather than enforcing fixed text heights.

Home prioritizes greeting, balance, primary top-up action, one campaign and recent transactions. Payment success is shown only after server confirms the cafe transfer. Pending, transferring, rejected, connection errors, empty history and loading skeletons have distinct UI.

Brand colors: #FFAA16 primary, #48B9FF accent, #090C12 background, #131923 surface, #263142 border, #F5F7FC text, #9BA8BB secondary text. Screen-level decorative gradients are currently local to the corresponding brand components; functional colors use theme tokens.
