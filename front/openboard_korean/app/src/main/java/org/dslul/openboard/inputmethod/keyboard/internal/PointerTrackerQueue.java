/*
 * Copyright (C) 2010 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.dslul.openboard.inputmethod.keyboard.internal;

import android.util.Log;

import java.util.ArrayList;

public final class PointerTrackerQueue {
    private static final String TAG = PointerTrackerQueue.class.getSimpleName();
    private static final boolean DEBUG = false;

    public interface Element {
        boolean isModifier();
        boolean isInDraggingFinger();
        void onPhantomUpEvent(long eventTime);
        void cancelTrackingForAction();
    }

    private static final int INITIAL_CAPACITY = 10;
    // Note: {@link #mExpandableArrayOfActivePointers} and {@link #mArraySize} are synchronized by
    // {@link #mExpandableArrayOfActivePointers}
    private final ArrayList<Element> mExpandableArrayOfActivePointers =
            new ArrayList<>(INITIAL_CAPACITY);
    private int mArraySize = 0;

    public int size() {
        synchronized (mExpandableArrayOfActivePointers) {
            return mArraySize;
        }
    }

    public void add(final Element pointer) {
        synchronized (mExpandableArrayOfActivePointers) {
            if (DEBUG) {
                Log.d(TAG, "add: " + pointer + " " + this);
            }
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            if (arraySize < expandableArray.size()) {
                expandableArray.set(arraySize, pointer);
            } else {
                expandableArray.add(pointer);
            }
            mArraySize = arraySize + 1;
        }
    }

    public void remove(final Element pointer) {
        synchronized (mExpandableArrayOfActivePointers) {
            if (DEBUG) {
                Log.d(TAG, "remove: " + pointer + " " + this);
            }
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            int newIndex = 0;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element == pointer) {
                    if (newIndex != index) {
                        Log.w(TAG, "Found duplicated element in remove: " + pointer);
                    }
                    continue; // Remove this element from the expandableArray.
                }
                if (newIndex != index) {
                    // Shift this element toward the beginning of the expandableArray.
                    expandableArray.set(newIndex, element);
                }
                newIndex++;
            }
            mArraySize = newIndex;
        }
    }

    public Element getOldestElement() {
        synchronized (mExpandableArrayOfActivePointers) {
            return (mArraySize == 0) ? null : mExpandableArrayOfActivePointers.get(0);
        }
    }

    public void releaseAllPointersOlderThan(final Element pointer, final long eventTime) {
        synchronized (mExpandableArrayOfActivePointers) {
            if (DEBUG) {
                Log.d(TAG, "releaseAllPointerOlderThan: " + pointer + " " + this);
            }
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            int newIndex, index;
            for (newIndex = index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element == pointer) {
                    break; // Stop releasing elements.
                }
                if (!element.isModifier()) {
                    element.onPhantomUpEvent(eventTime);
                    continue; // Remove this element from the expandableArray.
                }
                if (newIndex != index) {
                    // Shift this element toward the beginning of the expandableArray.
                    expandableArray.set(newIndex, element);
                }
                newIndex++;
            }
            // Shift rest of the expandableArray.
            int count = 0;
            for (; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element == pointer) {
                    count++;
                    if (count > 1) {
                        Log.w(TAG, "Found duplicated element in releaseAllPointersOlderThan: "
                                + pointer);
                    }
                }
                if (newIndex != index) {
                    // Shift this element toward the beginning of the expandableArray.
                    expandableArray.set(newIndex, expandableArray.get(index));
                }
                newIndex++;
            }
            mArraySize = newIndex;
        }
    }

    public void releaseAllPointers(final long eventTime) {
        releaseAllPointersExcept(null, eventTime);
    }

    public void releaseAllPointersExcept(final Element pointer, final long eventTime) {
        synchronized (mExpandableArrayOfActivePointers) {
            if (DEBUG) {
                if (pointer == null) {
                    Log.d(TAG, "releaseAllPointers: " + this);
                } else {
                    Log.d(TAG, "releaseAllPointerExcept: " + pointer + " " + this);
                }
            }
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            int newIndex = 0, count = 0;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element == pointer) {
                    count++;
                    if (count > 1) {
                        Log.w(TAG, "Found duplicated element in releaseAllPointersExcept: "
                                + pointer);
                    }
                } else {
                    element.onPhantomUpEvent(eventTime);
                    continue; // Remove this element from the expandableArray.
                }
                if (newIndex != index) {
                    // Shift this element toward the beginning of the expandableArray.
                    expandableArray.set(newIndex, element);
                }
                newIndex++;
            }
            mArraySize = newIndex;
        }
    }

    public boolean hasModifierKeyOlderThan(final Element pointer) {
        synchronized (mExpandableArrayOfActivePointers) {
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element == pointer) {
                    return false; // Stop searching modifier key.
                }
                if (element.isModifier()) {
                    return true;
                }
            }
            return false;
        }
    }

    public boolean isAnyInDraggingFinger() {
        synchronized (mExpandableArrayOfActivePointers) {
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (element.isInDraggingFinger()) {
                    return true;
                }
            }
            return false;
        }
    }

    public void cancelAllPointerTrackers() {
        synchronized (mExpandableArrayOfActivePointers) {
            if (DEBUG) {
                Log.d(TAG, "cancelAllPointerTracker: " + this);
            }
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                element.cancelTrackingForAction();
            }
        }
    }

    @Override
    public String toString() {
        synchronized (mExpandableArrayOfActivePointers) {
            final StringBuilder sb = new StringBuilder();
            final ArrayList<Element> expandableArray = mExpandableArrayOfActivePointers;
            final int arraySize = mArraySize;
            for (int index = 0; index < arraySize; index++) {
                final Element element = expandableArray.get(index);
                if (sb.length() > 0) {
                    sb.append(" ");
                }
                sb.append(element.toString());
            }
            return "[" + sb.toString() + "]";
        }
    }
}
