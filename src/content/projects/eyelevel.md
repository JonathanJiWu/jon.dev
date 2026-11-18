---
title: EyeLevel
summary: A movie app in React Native. Browse and search films from TMDB, open full credits, and keep a personal watchlist and friends list synced through Firebase.
kind: Personal
status: In progress
period: Since 2025
stack: [React Native, Expo, TypeScript, Firebase, TMDB API, NativeWind]
order: 5
image: ../../assets/projects/eyelevel.webp
imageAlt: EyeLevel in dark mode. A search bar above a grid of movie posters, each with an add-to-watchlist button.
links:
  - label: Source on GitHub
    href: https://github.com/JonathanJiWu/eyelevel
    kind: source
---

## What it does

- Browse popular movies and search TMDB's catalogue.
- Open a movie to see its director, cast, genres, spoken languages and release date.
- Sign in with Firebase Authentication. Your watchlist and friends list live in your own Firestore user document.
- Switch between light and dark themes, in portrait or landscape.

## How it's built

- **Expo (SDK 52) with Expo Router.** Routing is file-based: tab screens, a search screen, and a dynamic `movie/[id]` route for each film.
- **TypeScript throughout.** Styling uses NativeWind (Tailwind for React Native) and the tabs use React Navigation.
- **A small TMDB layer.** An axios API module and a `useMovies` hook keep the network calls in one place.

## History

EyeLevel is the latest version of a movie watchlist I first built in 2021. That version was my first full-stack app: a React and Material UI frontend over a [Spring Boot, Hibernate and MySQL backend](https://github.com/JonathanJiWu/movie-watchlist-react-springboot-mysql). The 2025 rebuild moved it to mobile, with Firebase for accounts and sync.
