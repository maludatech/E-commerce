"use server";

import { Cart, IOrderList, OrderItem, ShippingAddress } from "@/types";
import { formatError, round2 } from "../utils";
import { AVAILABLE_DELIVERY_DATES, PAGE_SIZE } from "../constants";
import { connectToDb } from "@/utils/database";
import { auth } from "@/auth";
import { OrderInputSchema } from "../validator";
import Order, { IOrder } from "@/db/models/order.model";
import { sendPurchaseReceipt } from "@/emails";
import { DateRange } from "@/types";
import Product from "@/db/models/product.model";
import User from "@/db/models/user.model";
import { revalidatePath } from "next/cache";

export const calculateDeliveryDateAndPrice = async ({
  items,
  shippingAddress,
  deliveryDateIndex,
}: {
  deliveryDateIndex?: number;
  items: OrderItem[];
  shippingAddress?: ShippingAddress;
}) => {
  const availableDeliveryDates = AVAILABLE_DELIVERY_DATES;
  const itemsPrice = round2(
    items.reduce((acc, item) => acc + item.price * item.quantity, 0)
  );

  const deliveryDate =
    availableDeliveryDates[
      deliveryDateIndex === undefined
        ? availableDeliveryDates.length - 1
        : deliveryDateIndex
    ];
  const shippingPrice =
    !shippingAddress || !deliveryDate
      ? undefined
      : deliveryDate.freeShippingMinPrice > 0 &&
          itemsPrice >= deliveryDate.freeShippingMinPrice
        ? 0
        : deliveryDate.shippingPrice;

  const taxPrice = !shippingAddress ? undefined : round2(itemsPrice * 0.15);
  const totalPrice = round2(
    itemsPrice +
      (shippingPrice ? round2(shippingPrice) : 0) +
      (taxPrice ? round2(taxPrice) : 0)
  );
  return {
    availableDeliveryDates,
    deliveryDateIndex:
      deliveryDateIndex === undefined
        ? availableDeliveryDates.length - 1
        : deliveryDateIndex,
    itemsPrice,
    shippingPrice,
    taxPrice,
    totalPrice,
  };
};

// CREATE
export const createOrder = async (clientSideCart: Cart) => {
  try {
    await connectToDb();
    const session = await auth();
    if (!session) throw new Error("User not authenticated");
    // recalculate price and delivery date on the server
    const createdOrder = await createOrderFromCart(
      clientSideCart,
      session.user.id!
    );
    return {
      success: true,
      message: "Order placed successfully",
      data: { orderId: createdOrder._id.toString() },
    };
  } catch (error) {
    return { success: false, message: formatError(error) };
  }
};

export const createOrderFromCart = async (
  clientSideCart: Cart,
  userId: string
) => {
  const cart = {
    ...clientSideCart,
    ...calculateDeliveryDateAndPrice({
      items: clientSideCart.items,
      shippingAddress: clientSideCart.shippingAddress,
      deliveryDateIndex: clientSideCart.deliveryDateIndex,
    }),
  };

  const order = OrderInputSchema.parse({
    user: userId,
    items: cart.items,
    shippingAddress: cart.shippingAddress,
    paymentMethod: cart.paymentMethod,
    itemsPrice: cart.itemsPrice,
    shippingPrice: cart.shippingPrice,
    taxPrice: cart.taxPrice,
    totalPrice: cart.totalPrice,
    expectedDeliveryDate: cart.expectedDeliveryDate,
  });
  return await Order.create(order);
};

export async function getMyOrders({
  limit,
  page,
}: {
  limit?: number;
  page: number;
}) {
  // const {
  //   common: { pageSize },
  // } = await getSetting();

  limit = limit || PAGE_SIZE;
  await connectToDb();
  const session = await auth();
  if (!session) {
    throw new Error("User is not authenticated");
  }
  const skipAmount = (Number(page) - 1) * limit;
  const orders = await Order.find({
    user: session?.user?.id,
  })
    .sort({ createdAt: "desc" })
    .skip(skipAmount)
    .limit(limit);
  const ordersCount = await Order.countDocuments({ user: session?.user?.id });

  return {
    data: JSON.parse(JSON.stringify(orders)),
    totalPages: Math.ceil(ordersCount / limit),
  };
}

export async function getOrderById(orderId: string): Promise<IOrder> {
  await connectToDb();
  const order = await Order.findById(orderId);
  return JSON.parse(JSON.stringify(order));
}

// GET ORDERS BY USER
export async function getOrderSummary(date: DateRange) {
  await connectToDb();

  const ordersCount = await Order.countDocuments({
    createdAt: {
      $gte: date.from,
      $lte: date.to,
    },
  });
  const productsCount = await Product.countDocuments({
    createdAt: {
      $gte: date.from,
      $lte: date.to,
    },
  });
  const usersCount = await User.countDocuments({
    createdAt: {
      $gte: date.from,
      $lte: date.to,
    },
  });

  const totalSalesResult = await Order.aggregate([
    {
      $match: {
        createdAt: {
          $gte: date.from,
          $lte: date.to,
        },
      },
    },
    {
      $group: {
        _id: null,
        sales: { $sum: "$totalPrice" },
      },
    },
    { $project: { totalSales: { $ifNull: ["$sales", 0] } } },
  ]);
  const totalSales = totalSalesResult[0] ? totalSalesResult[0].totalSales : 0;

  const today = new Date();
  const sixMonthEarlierDate = new Date(
    today.getFullYear(),
    today.getMonth() - 5,
    1
  );
  const monthlySales = await Order.aggregate([
    {
      $match: {
        createdAt: {
          $gte: sixMonthEarlierDate,
        },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        totalSales: { $sum: "$totalPrice" },
      },
    },
    {
      $project: {
        _id: 0,
        label: "$_id",
        value: "$totalSales",
      },
    },

    { $sort: { label: -1 } },
  ]);
  const topSalesCategories = await getTopSalesCategories(date);
  const topSalesProducts = await getTopSalesProducts(date);

  // const {
  //   common: { pageSize },
  // } = await getSetting()
  // const limit = pageSize
  const latestOrders = await Order.find()
    .populate("user", "name")
    .sort({ createdAt: "desc" })
    .limit(PAGE_SIZE);
  return {
    ordersCount,
    productsCount,
    usersCount,
    totalSales,
    monthlySales: JSON.parse(JSON.stringify(monthlySales)),
    salesChartData: JSON.parse(JSON.stringify(await getSalesChartData(date))),
    topSalesCategories: JSON.parse(JSON.stringify(topSalesCategories)),
    topSalesProducts: JSON.parse(JSON.stringify(topSalesProducts)),
    latestOrders: JSON.parse(JSON.stringify(latestOrders)) as IOrderList[],
  };
}

async function getSalesChartData(date: DateRange) {
  const result = await Order.aggregate([
    {
      $match: {
        createdAt: {
          $gte: date.from,
          $lte: date.to,
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        },
        totalSales: { $sum: "$totalPrice" },
      },
    },
    {
      $project: {
        _id: 0,
        date: {
          $concat: [
            { $toString: "$_id.year" },
            "/",
            { $toString: "$_id.month" },
            "/",
            { $toString: "$_id.day" },
          ],
        },
        totalSales: 1,
      },
    },
    { $sort: { date: 1 } },
  ]);

  return result;
}

async function getTopSalesProducts(date: DateRange) {
  const result = await Order.aggregate([
    {
      $match: {
        createdAt: {
          $gte: date.from,
          $lte: date.to,
        },
      },
    },
    // Step 1: Unwind orderItems array
    { $unwind: "$items" },

    // Step 2: Group by productId to calculate total sales per product
    {
      $group: {
        _id: {
          name: "$items.name",
          image: "$items.image",
          _id: "$items.product",
        },
        totalSales: {
          $sum: { $multiply: ["$items.quantity", "$items.price"] },
        }, // Assume quantity field in orderItems represents units sold
      },
    },
    {
      $sort: {
        totalSales: -1, //descending order
      },
    },
    { $limit: 6 },

    // Step 3: Replace productInfo array with product name and format the output
    {
      $project: {
        _id: 0,
        id: "$_id._id",
        label: "$_id.name",
        image: "$_id.image",
        value: "$totalSales",
      },
    },

    // Step 4: Sort by totalSales in descending order
    { $sort: { _id: 1 } },
  ]);

  return result;
}

async function getTopSalesCategories(date: DateRange, limit = 5) {
  const result = await Order.aggregate([
    {
      $match: {
        createdAt: {
          $gte: date.from,
          $lte: date.to,
        },
      },
    },
    // Step 1: Unwind orderItems array
    { $unwind: "$items" },
    // Step 2: Group by productId to calculate total sales per product
    {
      $group: {
        _id: "$items.category",
        totalSales: { $sum: "$items.quantity" }, // Assume quantity field in orderItems represents units sold
      },
    },
    // Step 3: Sort by totalSales in descending order
    { $sort: { totalSales: -1 } },
    // Step 4: Limit to top N products
    { $limit: limit },
  ]);

  return result;
}

// DELETE
export async function deleteOrder(id: string) {
  try {
    await connectToDb();
    const res = await Order.findByIdAndDelete(id);
    if (!res) throw new Error("Order not found");
    revalidatePath("/admin/orders");
    return {
      success: true,
      message: "Order deleted successfully",
    };
  } catch (error) {
    return { success: false, message: formatError(error) };
  }
}

// GET ALL ORDERS

export async function getAllOrders({
  limit,
  page,
}: {
  limit?: number;
  page: number;
}) {
  limit = limit || PAGE_SIZE;
  await connectToDb();
  const skipAmount = (Number(page) - 1) * limit;
  const orders = await Order.find()
    .populate("user", "name")
    .sort({ createdAt: "desc" })
    .skip(skipAmount)
    .limit(limit);
  const ordersCount = await Order.countDocuments();
  return {
    data: JSON.parse(JSON.stringify(orders)) as IOrderList[],
    totalPages: Math.ceil(ordersCount / limit),
  };
}
