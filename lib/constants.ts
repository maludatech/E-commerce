const date = new Date();
const currentYear = date.getFullYear();

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Steeze Boutique";

export const APP_SLOGAN =
  process.env.NEXT_PUBLIC_APP_SLOGAN || "Spend less, enjoy more";

export const PAGE_SIZE = Number(process.env.PAGE_SIZE || 9);

export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
  "E-commerce website built using Next.JS and MongoDB";

export const FREE_SHIPPING_MIN_PRICE = Number(
  process.env.FREE_SHIPPING_MIN_PRICE || 35
);

export const APP_COPYRIGHT = `Copyright © ${currentYear} ${APP_NAME}. All rights reserved`;
