import data from "@/lib/data";
import { connectToDb } from "@/utils/database";
import Product from "./models/product.model";
import User from "./models/user.model";
import Review from "./models/review.model";
import { cwd } from "process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(cwd());

const main = async () => {
  try {
    const { products, users, reviews } = data;
    await connectToDb();

    await User.deleteMany();
    const createdUsers = await User.insertMany(users);

    await Product.deleteMany();
    const createdProducts = await Product.insertMany(products);

    await Review.deleteMany();
    const rws = [];
    for (let i = 0; i < createdProducts.length; i++) {
      let x = 0;
      const { ratingDistribution } = createdProducts[i];
      for (let j = 0; j < ratingDistribution.length; j++) {
        for (let k = 0; k < ratingDistribution[j].count; k++) {
          x++;
          rws.push({
            ...reviews.filter((x) => x.rating === j + 1)[
              x % reviews.filter((x) => x.rating === j + 1).length
            ],
            isVerifiedPurchase: true,
            product: createdProducts[i]._id,
            user: createdUsers[x % createdUsers.length]._id,
            updatedAt: Date.now(),
            createdAt: Date.now(),
          });
        }
      }
    }
    const createdReviews = await Review.insertMany(rws);

    console.log({
      createdProducts,
      createdUsers,
      createdReviews,
      message: "Seeded database successfully",
    });
    process.exit(0);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to seed database");
  }
};

main();
