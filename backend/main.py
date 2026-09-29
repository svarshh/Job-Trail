def main():
    # set up html extraction pipeline

    import requests
    from bs4 import BeautifulSoup

    url = "https://github.com"

    response = requests.get(url)

    html_content = response.text

    soup = BeautifulSoup(html_content, "html.parser")

    body_html = soup.body

    print(body_html)




if __name__ == "__main__":
    main()
