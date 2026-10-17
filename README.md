# cloud-init-webgeniso

Generate [cloud-init](https://cloudinit.readthedocs.io/) NoCloud seed ISO images directly in your browser.

## What it produces

A small ISO 9660 image equivalent to:

```sh
genisoimage -output seed.img -volid cidata -rational-rock -joliet user-data meta-data [network-config] [vendor-data]
```

It is not meant as a general-purpose ISO creation tool: no support for subdirectories, boot images, large files or anything fancy, just the following:
- Volume label `cidata`, recognised by cloud-init's NoCloud datasource
- Flat root directory holding `user-data`, `meta-data` and, optionally, `network-config` and `vendor-data`
- Rock Ridge and Joliet extensions

## License

Copyright (C) 2026 Kenji Gaillac

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your
option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

In practice: anyone who distributes this code, a modified version of it, or a
product that includes it, or who lets users interact with a modified version
over a network (for example a hosted web app), must make the complete source
code of their version available under the same license.
