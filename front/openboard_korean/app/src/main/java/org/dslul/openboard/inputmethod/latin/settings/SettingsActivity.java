/*
 * Copyright (C) 2012 The Android Open Source Project
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

package org.dslul.openboard.inputmethod.latin.settings;

import android.app.ActionBar;
import android.content.Intent;
import android.os.Bundle;
import android.preference.PreferenceActivity;
import android.view.MenuItem;

import org.dslul.openboard.inputmethod.latin.R;
import org.dslul.openboard.inputmethod.latin.permissions.PermissionsManager;
import org.dslul.openboard.inputmethod.latin.utils.FragmentUtils;

import androidx.core.app.ActivityCompat;

public final class SettingsActivity extends PreferenceActivity
        implements ActivityCompat.OnRequestPermissionsResultCallback {
    private static final String DEFAULT_FRAGMENT = SettingsFragment.class.getName();

    public static final String EXTRA_ENTRY_KEY = "entry";
    public static final String EXTRA_ENTRY_VALUE_LONG_PRESS_COMMA = "long_press_comma";
    public static final String EXTRA_ENTRY_VALUE_APP_ICON = "app_icon";
    public static final String EXTRA_ENTRY_VALUE_NOTICE_DIALOG = "important_notice";
    public static final String EXTRA_ENTRY_VALUE_SYSTEM_SETTINGS = "system_settings";

    private boolean mShowHomeAsUp;

    @Override
    protected void onCreate(final Bundle savedState) {
        super.onCreate(savedState);
        final ActionBar actionBar = getActionBar();
        if (actionBar != null) {
            actionBar.setDisplayHomeAsUpEnabled(true);
            actionBar.setHomeButtonEnabled(true);
        }
    }

    @Override
    public Intent getIntent() {
        final Intent intent = super.getIntent();
        final String fragment = intent.getStringExtra(EXTRA_SHOW_FRAGMENT);
        if (fragment == null) {
            intent.putExtra(EXTRA_SHOW_FRAGMENT, DEFAULT_FRAGMENT);
        }
        intent.putExtra(EXTRA_NO_HEADERS, true);
        return intent;
    }

    @Override
    public boolean isValidFragment(final String fragmentName) {
        return FragmentUtils.isValidFragment(fragmentName);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        PermissionsManager.get(this).onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(
                R.anim.slide_in_left,
                R.anim.slide_out_right
        );
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            // 백스택이 있으면 fragment 팝만
            if (getFragmentManager().getBackStackEntryCount() > 0) {
                getFragmentManager().popBackStack();
            } else {
                // 백스택 없으면 액티비티 종료
                finish();
            }
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    public void onBackPressed() {
        // 프래그먼트 매니저에서 백스택이 있으면 팝
        if (getFragmentManager().getBackStackEntryCount() > 0) {
            getFragmentManager().popBackStack();
        } else {
            // 백스택이 없으면 액티비티 종료
            super.onBackPressed();  // super.onBackPressed() → finish()
        }
    }

}
