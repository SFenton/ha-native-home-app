export type Primitive = string | number | boolean | null;
/** Any JSON value: the shape of a node's props, a service call's data and a Home Assistant attribute. */
export type Json = Primitive | Json[] | { [key: string]: Json };
