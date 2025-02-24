"use server";

import { revalidatePath } from "next/cache";

import { connectToDb } from "@/utils/database";
import WebPage, { IWebPage } from "@/db/models/web-page.model";
import { formatError } from "@/lib/utils";

// DELETE
export async function deleteWebPage(id: string) {
  try {
    await connectToDb();
    const res = await WebPage.findByIdAndDelete(id);
    if (!res) throw new Error("WebPage not found");
    revalidatePath("/admin/web-pages");
    return {
      success: true,
      message: "WebPage deleted successfully",
    };
  } catch (error) {
    return { success: false, message: formatError(error) };
  }
}

// GET ALL
export async function getAllWebPages() {
  await connectToDb();
  const webPages = await WebPage.find();
  return JSON.parse(JSON.stringify(webPages)) as IWebPage[];
}
export async function getWebPageById(webPageId: string) {
  await connectToDb();
  const webPage = await WebPage.findById(webPageId);
  return JSON.parse(JSON.stringify(webPage)) as IWebPage;
}

// GET ONE PAGE BY SLUG
export async function getWebPageBySlug(slug: string) {
  await connectToDb();
  console.log("Slug: " + slug);
  const webPage = await WebPage.findOne({ slug, isPublished: true });
  if (!webPage) throw new Error("WebPage not found");
  return JSON.parse(JSON.stringify(webPage)) as IWebPage;
}
