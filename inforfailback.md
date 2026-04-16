What I already completed:

Loaded the launch agent successfully.
Confirmed the job starts on schedule.
Fixed the script path issue by using a runtime copy in your Library folder.
Updated the launchd config in com.save-to-server.sync.plist.
Current blocker from logs:

rsync error: Operation not permitted
It cannot read your source folder in OneDrive and cannot write to the mounted SMB path when launched by launchd.
What this means:

The launchd background process does not currently have the same file permissions your Terminal session has.
How to fix:

Open System Settings.
Go to Privacy & Security.
Open Full Disk Access.
Add and enable both:
/bin/zsh
/usr/bin/rsync
If prompted, restart your Mac or log out/in.
Then test again with:

launchctl kickstart -k gui/$(id -u)/com.save-to-server.sync
tail -n 80 "$HOME/Library/Application Support/save-to-server/logs/launchd.out.log"
tail -n 80 "$HOME/Library/Application Support/save-to-server/logs/launchd.err.log"
Success signs:

You see Sync finished
You see ==== Sync run end ====
No Operation not permitted errors
If you want, I can also add a fallback mode so launchd only mounts the share and then triggers sync through Terminal (which usually already has permissions).