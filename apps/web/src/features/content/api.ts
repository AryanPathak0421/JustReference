/** Phase 0: sample content. Phase 6: GET /api/v1/public/testimonials and /blog. */
import { SAMPLE_POSTS, SAMPLE_TESTIMONIALS } from '@/mocks/content';

export const getTestimonials = () => SAMPLE_TESTIMONIALS;
export const getLatestPosts = () => SAMPLE_POSTS;
export type Post = (typeof SAMPLE_POSTS)[number];
