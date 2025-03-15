import { v } from "convex/values"
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server"
import { Id } from "./_generated/dataModel"

export const createUser = mutation({
	args: {
		username: v.string(),
		fullname: v.string(),
		email: v.string(),
		bio: v.optional(v.string()),
		image: v.string(),
		clerkId: v.string(),
	},
	handler: async (ctx, args) => {
		const existingUser = await ctx.db
			.query("users")
			.withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
			.first()

		if (existingUser) return
		// create user
		await ctx.db.insert("users", {
			username: args.username,
			fullname: args.fullname,
			email: args.email,
			bio: args.bio,
			image: args.image,
			clerkId: args.clerkId,
			followers: 0,
			following: 0,
			posts: 0,
		})
	},
})

export async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity()
	if (!identity) throw new Error("Not authenticated")

	const currentUser = await ctx.db
		.query("users")
		.withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
		.first()
	if (!currentUser) throw new Error("User not found")

	return currentUser
}

export const getUserByClerkId = query({
	args: { clerkId: v.string() },
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
			.unique()

		return user
	},
})

export const updateProfile = mutation({
	args: {
		image: v.string(),
		fullname: v.string(),
		bio: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const currentUser = await getAuthenticatedUser(ctx)

		await ctx.db.patch(currentUser._id, { image: args.image, fullname: args.fullname, bio: args.bio })
	},
})

export const getUserProfile = query({
	args: { id: v.id("users") },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.id)

		if (!user) throw new Error("User not found")

		return user
	},
})

export const isFollowing = query({
	args: { followingId: v.id("users") },
	handler: async (ctx, args) => {
		const currentUser = await getAuthenticatedUser(ctx)

		const follow = await ctx.db
			.query("follows")
			.withIndex("by_both", (q) => q.eq("followerId", currentUser._id).eq("followingId", args.followingId))
			.first()

		return !!follow
	},
})

export const toggleFollow = mutation({
	args: { followingId: v.id("users") },
	handler: async (ctx, args) => {
		const currentUser = await getAuthenticatedUser(ctx)

		const existing = await ctx.db
			.query("follows")
			.withIndex("by_both", (q) => q.eq("followerId", currentUser._id).eq("followingId", args.followingId))
			.first()

		if (existing) {
			//unfollow
			await ctx.db.delete(existing._id)
			await updateFollowCounts(ctx, currentUser._id, args.followingId, false)

			await ctx.db.insert("notifications", {
				receiverId: args.followingId,
				senderId: currentUser._id,
				type: "unfollow",
			})
		} else {
			//follow
			await ctx.db.insert("follows", {
				followerId: currentUser._id,
				followingId: args.followingId,
			})
			await updateFollowCounts(ctx, currentUser._id, args.followingId, true)

			//create a notification
			await ctx.db.insert("notifications", {
				receiverId: args.followingId,
				senderId: currentUser._id,
				type: "follow",
			})
		}
	},
})

export const getFollowing = query({
	handler: async (ctx) => {
		const currentUser = await getAuthenticatedUser(ctx)

		const following = await ctx.db
			.query("follows")
			.withIndex("by_follower", (q) => q.eq("followerId", currentUser._id))
			.order("desc")
			.collect()

		const followingWithInfo = await Promise.all(
			following.map(async (follow) => {
				const following = await ctx.db.get(follow.followingId)
				return {
					...follow,
					username: following?.username,
					image: following?.image,
				}
			})
		)
		const result = [
			{
				_id: currentUser._id,
				username: "Ваша история",
				image: currentUser.image,
			},
			...followingWithInfo,
		]

		return result
	},
})

async function updateFollowCounts(ctx: MutationCtx, followerId: Id<"users">, followingId: Id<"users">, isFollow: boolean) {
	const follower = await ctx.db.get(followerId)
	const following = await ctx.db.get(followingId)

	if (follower && following) {
		await ctx.db.patch(followerId, {
			following: follower.following + (isFollow ? 1 : -1),
		})

		await ctx.db.patch(followingId, {
			followers: following.followers + (isFollow ? 1 : -1),
		})
	}
}
