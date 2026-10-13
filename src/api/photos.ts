import { functionErrorCode, messageForCode } from '@/lib/errors';
import { prepareAvatar, preparePhoto, randomHex32, type Encoded } from '@/lib/image-client';
import { supabase } from '@/lib/supabase';
import type { ListingPhoto } from './listings';

export class UploadError extends Error {}

async function stage(img: Encoded): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new UploadError(messageForCode('not_authenticated'));
  const path = `${auth.user.id}/${randomHex32()}.${img.ext}`; // random name: no enumeration, no overwrite
  const { error } = await supabase.storage.from('uploads').upload(path, img.blob, {
    contentType: img.mime,
    upsert: false,
  });
  if (error) throw new UploadError(messageForCode(null));
  return path;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('photos', { body });
  if (error) throw new UploadError(messageForCode(await functionErrorCode(error)));
  return data as T;
}

export async function uploadListingPhoto(listingId: string, file: File, sort: number) {
  const { full, thumb } = await preparePhoto(file);
  const [stagingPath, thumbPath] = await Promise.all([stage(full), stage(thumb)]);
  return invoke<Pick<ListingPhoto, 'id' | 'storage_path' | 'thumb_path' | 'width' | 'height' | 'sort'>>({
    action: 'finalize',
    target: 'listing',
    staging_path: stagingPath,
    thumb_path: thumbPath,
    listing_id: listingId,
    sort,
  });
}

export async function uploadAvatar(file: File) {
  const staging = await stage(await prepareAvatar(file));
  return invoke<{ avatar_path: string }>({ action: 'finalize', target: 'avatar', staging_path: staging });
}

export const deletePhoto = (photoId: string) => invoke<{ ok: true }>({ action: 'delete', photo_id: photoId });
