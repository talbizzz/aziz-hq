#!/bin/sh
# Dumps statusLine stdin JSON to $S1_STATUS_OUT (append, one object per line).
cat >> "${S1_STATUS_OUT:?}"
echo >> "$S1_STATUS_OUT"
echo "s1"
