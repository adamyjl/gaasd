"""Offline, approximate IP regions; no visitor information leaves this host."""

import ipaddress
import re
from functools import lru_cache
from pathlib import Path

from ip2region import searcher, util
from ua_parser import parse

BOT = re.compile(r"bot|spider|crawl|headless|curl/|wget/|python|playwright|gaasd-qa|uptime", re.I)


class GeoLookup:
    def __init__(self, directory):
        self.searchers = {}
        if directory:
            for version, kind in [(4, util.IPv4), (6, util.IPv6)]:
                filename = Path(directory) / f"ip2region_v{version}.xdb"
                util.verify_from_file(str(filename))
                self.searchers[version] = searcher.new_with_buffer(
                    kind, util.load_content_from_file(str(filename))
                )
        self.lookup = lru_cache(maxsize=8192)(self._lookup)

    def _lookup(self, ip):
        address = ipaddress.ip_address(ip)
        if not address.is_global:
            return dict(country="", province="", city="", isp="", region="本地或保留地址")
        value = self.searchers[address.version].search(ip) if self.searchers else ""
        fields = [(part if part != "0" else "") for part in value.split("|")]
        fields += [""] * (5 - len(fields))
        country, province, city, isp, _code = fields[:5]
        parts = list(dict.fromkeys(part for part in [country, province, city] if part))
        return dict(
            country=country,
            province=province,
            city=city,
            isp=isp,
            region=" · ".join(parts) or "未知地区",
        )


@lru_cache(maxsize=4096)
def browser_info(ua):
    result = parse(ua)
    agent = result.user_agent
    system = result.os
    browser = agent.family if agent else "未知浏览器"
    version = ".".join(str(part) for part in [agent.major, agent.minor] if part) if agent else ""
    if re.search(r"MicroMessenger|WindowsWechat", ua, re.I):
        browser = "微信浏览器"
        match = re.search(r"(?:MicroMessenger|WindowsWechat)/([\d.]+)", ua, re.I)
        version = match.group(1) if match else ""
    os_name = system.family if system else "未知系统"
    device = (
        "平板"
        if re.search(r"iPad|Tablet", ua, re.I)
        else "手机"
        if re.search(r"Mobile|iPhone|Android", ua, re.I)
        else "电脑"
    )
    return dict(
        browser=browser,
        browser_version=version,
        os=os_name,
        device=device,
        is_bot=int(bool(BOT.search(ua))),
    )
