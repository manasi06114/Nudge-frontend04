import { supabase } from './supabase';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function getHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

export interface ProductData {
  id: string;
  user_id: string;
  name: string;
  code: string | null;
  category: string;
  expiry_date: string;
  quantity: number;
  location: string;
  days_left: number;
  urgency_stage: 'expired' | 'critical' | 'urgent' | 'warning' | 'safe';
  created_at: string;
}

export async function fetchProducts(): Promise<ProductData[]> {
  const headers = await getHeaders();
  const response = await fetch(`${BASE_URL}/api/products`, {
    headers,
  });
  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }
  const result = await response.json();
  return result.data || [];
}

export async function createProduct(productData: {
  name: string;
  code?: string | null;
  category: string;
  expiryDate: string;
  quantity?: number;
  location?: string;
}): Promise<ProductData> {
  const headers = await getHeaders();
  const response = await fetch(`${BASE_URL}/api/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(productData),
  });
  if (!response.ok) {
    throw new Error('Failed to create product');
  }
  const result = await response.json();
  return result.data;
}

export async function updateProduct(
  id: string,
  productData: {
    name?: string;
    code?: string | null;
    category?: string;
    expiryDate?: string;
    quantity?: number;
    location?: string;
  }
): Promise<ProductData> {
  const headers = await getHeaders();
  const response = await fetch(`${BASE_URL}/api/products/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(productData),
  });
  if (!response.ok) {
    throw new Error('Failed to update product');
  }
  const result = await response.json();
  return result.data;
}

export async function deleteProduct(id: string): Promise<{ success: boolean; message: string }> {
  const headers = await getHeaders();
  const response = await fetch(`${BASE_URL}/api/products/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    throw new Error('Failed to delete product');
  }
  return response.json();
}
